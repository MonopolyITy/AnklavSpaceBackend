// bot.js
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { User } from '../models/User.js';
import { Room } from '../models/Room.js';
import { ArchivedRoom } from '../models/ArchivedRoom.js';
import CyrillicToTranslit from 'cyrillic-to-translit-js';

const translit = new CyrillicToTranslit({ preset: 'uk' })

// Латиница → кириллица (обратное)
const fromLatin = (text) => translit.reverse(text);

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

// ─────────────────────────────────────────────
// Post-test flow helpers
// ─────────────────────────────────────────────
const LINKS = {
  channel: process.env.ARTEM_CHANNEL_URL || 'https://t.me/thekhromykh',
  site: process.env.SITE_URL || 'https://anklav.legal/space#prev',
};
const postTestTimers = new Map(); // key: telegramId → timeout

const buildDisplayName = (userDoc) => {
  const name = [userDoc.firstName, userDoc.lastName].filter(Boolean).join(' ') || userDoc.name || 'Без имени';
  const safe = String(name).trim().replace(/\s+/g, ' ');
  const nick = userDoc.username ? `@${userDoc.username}` : '(без никнейма)';
  return { safeName: safe, nickLabel: nick };
};

const profileUrlFor = (userDoc) => userDoc.username ? `https://t.me/${userDoc.username}` : `tg://user?id=${userDoc.telegramId}`;

async function sendLeadApplicationToGroup(telegramId) {
  try {
    const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
    const user = await User.findOne({ telegramId }).lean();
    if (!user || !GROUP_CHAT_ID) return;

    const { safeName, nickLabel } = buildDisplayName(user);

    // Последняя архивная комната с участием пользователя
    const archivedRoom = await ArchivedRoom.findOne({ 'answers.id': String(telegramId) })
      .sort({ archivedAt: -1 })
      .lean();

    const participantFromArchive = archivedRoom?.answers?.find(a => String(a.id) === String(telegramId));
    const roomId = archivedRoom?.roomId ?? '—';
    const membersCount = Array.isArray(archivedRoom?.members) ? archivedRoom.members.length : '—';

    // ── Шапка: как в примере ─────────────────────────────────────────────
    let message = `<b>📊 Заявка на разбор партнёрства</b>\n\n`;
    message += `👤 <b>Участник:</b> ${nickLabel} — <b>${safeName}</b>\n`;
    message += `<b>Комната:</b> ${roomId}\n`;
    message += `<b>Участников:</b> ${membersCount}\n\n`;

    // ── Ответы и результаты, если есть архив ─────────────────────────────
    if (archivedRoom && participantFromArchive) {
      // 🧠 Ответы на вопросы (если сохранены)
      if (Array.isArray(participantFromArchive.questions_answers) && participantFromArchive.questions_answers.length) {
        message += `<b>🧠 Ответы на вопросы:</b>\n`;
        participantFromArchive.questions_answers.forEach((ans, i) => {
          const t = String(ans ?? '').trim().replace(/\s+/g, ' ');
          message += `${i + 1}. ${t}\n`;
        });
        message += `\n`;
      }

      // 📈 Средние доли по капиталам
      if (archivedRoom?.result?.capitals && Array.isArray(archivedRoom.members)) {
        message += `<b>Средние доли по капиталам</b>\n`;
        for (const m of archivedRoom.members) {
          const displayName = m?.startsWith('us') ? fromLatin(m.slice(2)) : m;
          const caps = archivedRoom.result.capitals[m] || { econ: 0, human: 0, social: 0 };
          message += `• ${displayName}\n`;
          message += `<code>Экон ${pad(((caps.econ ?? 0)).toFixed(1))} %  ${bar(caps.econ ?? 0)}</code>\n`;
          message += `<code>Чел  ${pad(((caps.human ?? 0)).toFixed(1))} %  ${bar(caps.human ?? 0)}</code>\n`;
          message += `<code>Соц  ${pad(((caps.social ?? 0)).toFixed(1))} %  ${bar(caps.social ?? 0)}</code>\n\n`;
        }
      }

      // 🧮 Итоговые доли
      if (Array.isArray(archivedRoom?.result?.shares) && archivedRoom.result.shares.length) {
        message += `<b>Итоговые доли</b>\n`;
        for (const s of archivedRoom.result.shares) {
          const nmRaw = typeof s.name === 'string' ? s.name : '';
          const displayName = nmRaw.startsWith('us') ? fromLatin(nmRaw.slice(2)) : nmRaw;
          message += `• <b>${String(displayName).trim()}</b>: <b>${s.share}%</b>\n`;
        }
      } else {
        message += `<i>Тест ещё не проходил.</i>\n\n`;
      }
    } else {
      // Нет архива — выводим как в примере без результатов
      message += `<i>Тест ещё не проходил.</i>\n\n`;
    }

    // ── Красивые кнопки с эмодзи ─────────────────────────────────────────
    const replyMarkupLead = {
      inline_keyboard: [
        [{ text: '👤 Открыть профиль', url: profileUrlFor(user) }],
      ],
    };

    await bot.sendMessage(GROUP_CHAT_ID, message, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: replyMarkupLead,
    });
  } catch (e) {
    console.error('Ошибка при отправке заявки в группу:', e);
  }
}

async function startPostTestFlow(userDoc, roomId) {
  const chatId = userDoc.telegramId;
  const { safeName } = buildDisplayName(userDoc);
  const kb = {
    inline_keyboard: [
      [
        { text: '✅ Да, спасибо', callback_data: `pt_yes:${chatId}` },
        { text: '🙅‍♂️ Нет', callback_data: `pt_no:${chatId}` },
      ],
      [{ text: '🧾 Запишите меня на разбор', callback_data: `pt_signup:${chatId}` }],
    ],
  };

  {
    const first = (safeName.split(' ')[0] || safeName);
    await bot.sendMessage(
      chatId,
      `${first}, удовлетворены ли вы результатом теста?`,
      { reply_markup: kb }
    );
  }

  // Таймер на 5 минут — если нет действий, отправляем follow-up
  clearTimeout(postTestTimers.get(chatId));
  const t = setTimeout(async () => {
    const followKb = {
      inline_keyboard: [
        [{ text: '🧾 Да, запишите на разбор', callback_data: `pt_follow_yes:${chatId}` }],
        [{ text: '❓ Нет, у меня другой вопрос', callback_data: `pt_follow_no:${chatId}` }],
      ],
    };
    await bot.sendMessage(
      chatId,
      `${safeName.split(' ')[0] || 'Имя'}, подскажите, для вас актуален вопрос разделения долей с партнёром?`,
      { reply_markup: followKb }
    );
  }, 5 * 60 * 1000);
  postTestTimers.set(chatId, t);
}

bot.on('callback_query', async (cb) => {
  try {
    const data = cb.data || '';
    if (!data.startsWith('pt_')) return; // не наш флоу

    const [action, idStr] = data.split(':');
    const uid = Number(idStr);
    clearTimeout(postTestTimers.get(uid));
    postTestTimers.delete(uid);

    const user = await User.findOne({ telegramId: uid });
    if (!user) return bot.answerCallbackQuery(cb.id);
    const { nickLabel, safeName } = buildDisplayName(user);

    // Удаляем сообщение с кнопками, по которым кликнули (не критично, если не получится)
    await bot.deleteMessage(cb.message.chat.id, cb.message.message_id).catch(() => {});

    if (action === 'pt_yes') {
      const kb = {
        inline_keyboard: [
          [{ text: '📞 Свяжите меня', callback_data: `pt_contact:${uid}` }],
          [
            { text: '📣 Канал Артёма', url: LINKS.channel },
            { text: '🌐 Сайт', url: LINKS.site },
          ],
        ],
      };
      await bot.sendMessage(
        cb.message.chat.id,
        'Мы были рады помочь! Если у вас остался вопрос по партнёрской сессии, вы всегда можете задать его <b>службе заботы</b>',
        { parse_mode: 'HTML', reply_markup: kb }
      );
    }

    if (action === 'pt_no') {
      const kb = { inline_keyboard: [[{ text: '🧾 Запишите меня на разбор', callback_data: `pt_signup:${uid}` }]] };
      await bot.sendMessage(
        cb.message.chat.id,
        'Это нормальная ситуация. Доли могут быть распределены по-другому. На встрече с Артёмом вы сможете определить, как лучше это сделать',
        { reply_markup: kb }
      );
    }

    if (action === 'pt_signup' || action === 'pt_follow_yes' || action === 'pt_contact') {
      const kb = {
        inline_keyboard: [
          [
            { text: '📣 Канал Артёма', url: LINKS.channel },
            { text: '🌐 Сайт', url: LINKS.site },
          ],
        ],
      };
      await bot.sendMessage(
        cb.message.chat.id,
        'Мы передали ваш контакт менеджеру! Валерия свяжется с вами в течение суток.',
        { reply_markup: kb }
      );
      await sendLeadApplicationToGroup(uid);
    }

    if (action === 'pt_follow_no') {
      const kb = {
        inline_keyboard: [
          [
            { text: '📣 Канал Артёма', url: LINKS.channel },
            { text: '🌐 Сайт', url: LINKS.site },
          ],
        ],
      };
      await bot.sendMessage(
        cb.message.chat.id,
        'Мы передали ваш контакт менеджеру! Валерия свяжется с вами в течение суток.',
        { reply_markup: kb }
      );
      await sendLeadApplicationToGroup(uid);
    }

    await bot.answerCallbackQuery(cb.id);
  } catch (e) {
    console.error('Ошибка в post-test callback:', e);
  }
});

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
      `👋 Привет, ${from.first_name || 'друг'}!\n «Три капитала» — экономический, человеческий и социальный. Пройди короткий тест и получи обоснованное распределение долей.`,
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
        message += `• <b>${m.startsWith('us') ? fromLatin(m.slice(2)) : m}</b>\n`;
        message += `<code>Экон ${pad(c.econ.toFixed(1))}%  ${bar(c.econ)}</code>\n`;
        message += `<code>Чел  ${pad(c.human.toFixed(1))}%  ${bar(c.human)}</code>\n`;
        message += `<code>Соц  ${pad(c.social.toFixed(1))}%  ${bar(c.social)}</code>\n\n`;
      }

      message += '<b>Итоговые доли</b>\n';
      for (const s of sortedShares) {
        message += `• <b>${s.name.startsWith('us') ? fromLatin(s.name.slice(2)) : s.name}</b>: <b>${s.share}%</b>\n`;
      }

      // Рассылка участникам (HTML)
      for (const ans of marked.answers) {
        const user = await User.findOne({ telegramId: ans.id });
        if (user) {
          await bot.sendMessage(user.telegramId, message, { parse_mode: 'HTML' });
          await startPostTestFlow(user, marked.roomId);
        }
      }

      // После успешной отправки — архивируем комнату, а не удаляем
      try {
        await ArchivedRoom.create({
          roomId: marked.roomId,
          maxMembers: marked.maxMembers,
          members: marked.members,
          answers: marked.answers,
          result: { weights, capitals, shares },
        });
        await Room.deleteOne({ _id: marked._id }); 
      } catch (archErr) {
        console.error('Ошибка при архивировании комнаты:', archErr);
      }
    }
  } catch (err) {
    console.error('Ошибка при проверке комнат:', err);
  }
}, 10000);
