// bot.js
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { User } from '../models/User.js';
import { Room } from '../models/Room.js';

dotenv.config();

export const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

const originalSendMessage = bot.sendMessage.bind(bot);
bot.sendMessage = async (...args) => {
  try {
    return await originalSendMessage(...args);
  } catch (err) {
    const status = err.response?.statusCode;
    if (status === 400 || status === 403) {
      console.warn(`⚠️  Пользователь недоступен (${status})`);
      return null;
    }
    console.error('Ошибка отправки сообщения:', err);
    return null;
  }
};

const replyMarkup = {
  inline_keyboard: [
    [{ text: '🚀 Открыть приложение', web_app: { url: 'https://anklavspace.netlify.app/' } }]
  ]
};

// Команда /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const from = msg.from;

  try {
    let user = await User.findOne({ telegramId: from.id });

    if (!user) {
      // Если нет — создаём нового
      user = new User({
        telegramId: from.id,
        username: from.username || '',
        firstName: from.first_name || '',
        lastName: from.last_name || '',
        languageCode: from.language_code || '',
        createdAt: new Date()
      });
      await user.save();
    }

    await bot.sendMessage(
      chatId,
      `👋 Привет, ${from.first_name || 'друг'}!`,
      { reply_markup: replyMarkup }
    );
  } catch (err) {
    console.error('Ошибка регистрации пользователя:', err);
    await bot.sendMessage(chatId, '⚠️ Ошибка при регистрации');
  }
});

export default bot;

// ─────────────────────────────────────────────
// Проверка комнат каждую минуту (с нормализацией и весами)
// ─────────────────────────────────────────────
const CAPS = ['econ', 'human', 'social'];

function computeRoomResult(room) {
  const members = room.members;
  const R = room.answers.length;

  // 1) Нормализуем ответы каждого участника так, чтобы по каждому капиталу сумма по партнёрам была 100
  const perRespondentNormalized = room.answers.map(ans => {
    const vec = {};
    members.forEach(m => (vec[m] = { econ: 0, human: 0, social: 0 }));

    // собственная оценка
    if (vec[ans.name]) {
      CAPS.forEach(k => {
        vec[ans.name][k] += Number(ans.self_input?.[k] || 0);
      });
    }
    // оценки партнёров
    for (const p of ans.partners_input || []) {
      if (!vec[p.partnerName]) continue;
      CAPS.forEach(k => {
        vec[p.partnerName][k] += Number(p?.[k] || 0);
      });
    }

    // нормализация по каждому капиталу на 100
    const norm = {};
    members.forEach(m => (norm[m] = { econ: 0, human: 0, social: 0 }));
    CAPS.forEach(k => {
      const sumK = members.reduce((s, m) => s + (vec[m][k] || 0), 0);
      if (sumK > 0) {
        members.forEach(m => {
          norm[m][k] = (vec[m][k] / sumK) * 100;
        });
      } else {
        // если данных нет — равные доли
        members.forEach(m => {
          norm[m][k] = 100 / members.length;
        });
      }
    });
    return norm;
  });

  // 2) Усредняем по респондентам
  const avg = {};
  members.forEach(m => (avg[m] = { econ: 0, human: 0, social: 0 }));
  perRespondentNormalized.forEach(norm => {
    members.forEach(m => {
      CAPS.forEach(k => {
        avg[m][k] += norm[m][k] / R;
      });
    });
  });

  // 3) Весы капиталов (если заданы в комнате — используем их, иначе равные)
  const w = room.weights && CAPS.every(k => typeof room.weights[k] === 'number')
    ? room.weights
    : { econ: 33.3333, human: 33.3333, social: 33.3334 };

  // 4) Считаем итоговые доли по формуле Share(i) = (1/100) * Σ_k [ w^k × p^k(i) ]
  let raw = members.map(name => ({
    name,
    share: CAPS.reduce((s, k) => s + (w[k] / 100) * avg[name][k], 0)
  }));

  // 5) Нормализуем на 100 из-за численных ошибок и красиво округляем до 0.1% с методом наибольших остаточных
  const totalRaw = raw.reduce((s, x) => s + x.share, 0) || 1;
  raw.forEach(x => (x.share = (x.share / totalRaw) * 100));

  let rounded = raw.map(x => {
    const unrounded = x.share;
    const r = Math.round(unrounded * 10) / 10;
    return { name: x.name, share: r, remainder: unrounded * 10 - Math.floor(unrounded * 10) };
  });
  let sumRounded = rounded.reduce((s, x) => s + x.share, 0);
  sumRounded = Math.round(sumRounded * 10) / 10;
  let delta = Number((100 - sumRounded).toFixed(1));
  while (Math.abs(delta) >= 0.1 - 1e-9) {
    if (delta > 0) {
      // добавить 0.1 тем, у кого остаток больше
      let idx = 0;
      for (let i = 1; i < rounded.length; i++) {
        if (rounded[i].remainder > rounded[idx].remainder) idx = i;
      }
      rounded[idx].share = Number((rounded[idx].share + 0.1).toFixed(1));
      rounded[idx].remainder = 0;
      delta = Number((delta - 0.1).toFixed(1));
    } else {
      // снять 0.1 у тех, у кого остаток меньше
      let idx = 0;
      for (let i = 1; i < rounded.length; i++) {
        if (rounded[i].remainder < rounded[idx].remainder) idx = i;
      }
      rounded[idx].share = Number((rounded[idx].share - 0.1).toFixed(1));
      rounded[idx].remainder = 1;
      delta = Number((delta + 0.1).toFixed(1));
    }
  }

  const finalCaps = {};
  members.forEach(m => {
    finalCaps[m] = {
      econ: Number(avg[m].econ.toFixed(1)),
      human: Number(avg[m].human.toFixed(1)),
      social: Number(avg[m].social.toFixed(1)),
    };
  });

  return { weights: w, capitals: finalCaps, shares: rounded };
}

function pad(num, width = 5) {
  const s = String(num);
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}
function bar(pct) {
  const total = 10;
  const filled = Math.round((pct / 100) * total);
  const empty = Math.max(0, total - filled);
  return '█'.repeat(filled) + '░'.repeat(empty);
}

setInterval(async () => {
  try {
    const rooms = await Room.find({});
    for (const room of rooms) {
      if (!room || !Array.isArray(room.answers)) continue;
      if (room.answers.length !== room.maxMembers) continue;
      if (room.resultSent) continue; // уже обработана

      // Атомарно помечаем комнату как обработанную, чтобы не продублировать рассылку
      const marked = await Room.findOneAndUpdate(
        { _id: room._id, $or: [ { resultSent: { $exists: false } }, { resultSent: false } ] },
        { $set: { resultSent: true } },
        { new: true }
      );
      if (!marked) continue; // кто-то другой уже обработал

      const { weights, capitals, shares } = computeRoomResult(marked);

      // Красивое HTML-сообщение для Telegram
      // Сортируем итоговые доли по убыванию
      const sortedShares = [...shares].sort((a, b) => b.share - a.share);

      let message = '';
      message += '<b>📊 Итог по тесту «Три капитала»</b>\n\n';
      message += '<i>Формула:</i> Share(i) = (1/100) × Σ [w_k × p_k(i)]\n';
      message += `<b>Веса:</b> Экон ${weights.econ.toFixed(1)}% · Чел ${weights.human.toFixed(1)}% · Соц ${weights.social.toFixed(1)}%\n\n`;

      message += '<b>Средние доли по капиталам</b>\n';
      for (const m of marked.members) {
        const c = capitals[m];
        message += `• <b>${m}</b>\n`;
        message += `<code>Экон ${pad(c.econ.toFixed(1))}%  ${bar(c.econ)}</code>\n`;
        message += `<code>Чел  ${pad(c.human.toFixed(1))}%  ${bar(c.human)}</code>\n`;
        message += `<code>Соц  ${pad(c.social.toFixed(1))}%  ${bar(c.social)}</code>\n\n`;
      }

      message += '<b>Итоговые доли</b>\n';
      for (const s of sortedShares) {
        message += `• <b>${s.name}</b>: <b>${s.share}%</b>\n`;
      }

      // Рассылка участникам (HTML)
      for (const ans of marked.answers) {
        const user = await User.findOne({ telegramId: ans.id });
        if (user) {
          await bot.sendMessage(user.telegramId, message, { parse_mode: 'HTML' });
        }
      }

      // После успешной отправки — удаляем комнату, чтобы не висела в БД
      try {
        await Room.deleteOne({ _id: marked._id });
      } catch (delErr) {
        console.error('Ошибка удаления комнаты:', delErr);
      }
    }
  } catch (err) {
    console.error('Ошибка при проверке комнат:', err);
  }
}, 10000);
