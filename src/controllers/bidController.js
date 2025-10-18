import bot from '../services/telegramService.js';
import { Room } from '../models/Room.js';
import { User } from '../models/User.js';
import { ArchivedRoom } from '../models/ArchivedRoom.js';

export const sendBidMessage = async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ error: 'Не передан Telegram ID' });
    }

    const pad = (num, width = 5) => {
      const s = String(num);
      return s.length >= width ? s : s + ' '.repeat(width - s.length);
    };
    const bar = (pct) => {
      const total = 10;
      const filled = Math.round((Number(pct) / 100) * total);
      const empty = Math.max(0, total - filled);
      return '█'.repeat(filled) + '░'.repeat(empty);
    };

    // 1) Проверяем пользователя по telegramId
    const user = await User.findOne({ telegramId: id });
    if (!user) {
      return res.status(400).json({ error: 'Пользователь не найден в базе' });
    }

    // 2) Ищем комнату в архиве, где этот пользователь участвовал
    const archivedRoom = await ArchivedRoom.findOne({ 'answers.id': String(id) });

    // 3) Готовим имя и кликабельную ссылку
    const participantFromArchive = archivedRoom?.answers?.find(a => String(a.id) === String(id));
    const rawName = ([user.firstName, user.lastName].filter(Boolean).join(' ') || user.name || 'Без имени');
    const safeName = String(rawName).trim().replace(/\s+/g, ' ');
    const userLink = user.username
      ? `<a href="https://t.me/${user.username}">${safeName}</a>`
      : `<a href="tg://user?id=${id}">${safeName}</a>`;

    // 4) Шапка заявки (единый стиль, как у итогов)
    let message = `<b>📊 Заявка на разбор партнёрства</b>\n\n`;
    const nickLabel = user.username ? `@${user.username}` : '(без никнейма)';
    message += `👤 <b>Участник:</b> ${nickLabel} — <b>${safeName}</b>\n`;
    const roomId = archivedRoom?.roomId ?? '—';
    const membersCount = Array.isArray(archivedRoom?.members) ? archivedRoom.members.length : '—';
    message += `<b>Комната:</b> ${roomId}\n`;
    message += `<b>Участников:</b> ${membersCount}\n\n`;

    // 5) Если пользователь найден в архиве — выводим ответы/оценки
    if (archivedRoom && participantFromArchive) {
      // 🧠 Ответы на вопросы (массив строк)
      if (Array.isArray(participantFromArchive.questions_answers) && participantFromArchive.questions_answers.length) {
        message += `<b>🧠 Ответы на вопросы:</b>\n`;
        participantFromArchive.questions_answers.forEach((ans, i) => {
          const t = String(ans ?? '').trim().replace(/\s+/g, ' ');
          message += `${i + 1}. ${t}\n`;
        });
        message += `\n`;
      }

      // 📈 Итоговые доли (если сохранены в архиве)
      if (archivedRoom?.result?.capitals && archivedRoom?.members?.length) {
        message += `<b>Средние доли по капиталам</b>\n`;
        for (const m of archivedRoom.members) {
          const caps = archivedRoom.result.capitals[m] || { econ: 0, human: 0, social: 0 };
          message += `• ${m}\n`;
          message += `<code>Экон ${pad((caps.econ ?? 0).toFixed(1))} %  ${bar(caps.econ)}</code>\n`;
          message += `<code>Чел  ${pad((caps.human ?? 0).toFixed(1))} %  ${bar(caps.human)}</code>\n`;
          message += `<code>Соц  ${pad((caps.social ?? 0).toFixed(1))} %  ${bar(caps.social)}</code>\n\n`;
        }
      }

      if (archivedRoom?.result?.shares?.length) {
        message += `<b>Итоговые доли</b>\n`;
        for (const s of archivedRoom.result.shares) {
          const nm = String(s.name ?? '').trim().replace(/\s+/g, ' ');
          message += `• ${nm}: <b>${s.share}%</b>\n`;
        }
      } else {
        // Архив есть, но расчёта нет
        message += `<i>Тест ещё не проходил.</i>\n\n`;
      }
    } else {
      // Нет архива — та же форма, без результатов
      message += `<i>Тест ещё не проходил.</i>\n\n`;
    }

    const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
    const profileUrl = user.username ? `https://t.me/${user.username}` : `tg://user?id=${id}`;
    const replyMarkup = { inline_keyboard: [[{ text: '👤 Открыть профиль', url: profileUrl }]] };
    await bot.sendMessage(GROUP_CHAT_ID, message, { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: replyMarkup });

    return res.json({ success: true });
  } catch (error) {
    console.error('Ошибка при отправке заявки на разбор:', error);
    return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
};