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

    // 4) Шапка заявки (plain text + entities) — без parse_mode
    // Требуемый вид:
    //  👤 Участник: @xvnex - Xvnex
    //  если нет никнейма → @ - Xvnex
    //  если ошибка в имени → @xvnex - User

    // username label strictly as requested
    const hasUsername = Boolean(user.username);
    const shownUsername = hasUsername ? `@${user.username}` : '@';

    // build display name with validation; fallback to 'User' on suspicious/empty
    const buildDisplayName = () => {
      let nm = [user.firstName, user.lastName].filter(Boolean).join(' ').trim().replace(/\s+/g, ' ');
      if (!nm || nm.length < 2 || /undefined|null/i.test(nm) || /[<>]/.test(nm)) return 'User';
      return nm;
    };
    const displayName = buildDisplayName();

    // We'll collect text and entities
    let text = '';
    const entities = [];

    // Title (bold)
    {
      const title = '📊 Заявка на разбор партнёрства';
      const start = text.length; text += title + '\n\n';
      entities.push({ type: 'bold', offset: start, length: title.length });
    }

    // Header line (participant): "👤 Участник: <username> -  <displayName>"
    // Note: there are two spaces after the dash to match the example
    {
      const prefix = '👤 Участник: ';
      const header = `${prefix}${shownUsername} -  ${displayName}`;
      const headerStart = text.length;
      text += header + '\n';

      // Make only the displayName clickable
      const nameOffsetInHeader = header.length - displayName.length; // end-based calc
      const globalNameOffset = headerStart + nameOffsetInHeader;

      if (hasUsername) {
        entities.push({ type: 'text_link', offset: globalNameOffset, length: displayName.length, url: `https://t.me/${user.username}` });
      } else {
        // users without usernames → use text_mention entity to open by id
        entities.push({ type: 'text_mention', offset: globalNameOffset, length: displayName.length, user: { id: Number(id), first_name: displayName } });
      }
    }

    // Room / members (bold labels)
    {
      const label1 = 'Комната:'; const val1 = archivedRoom?.roomId ?? '—';
      const start = text.length; const line = `${label1} ${val1}`; text += line + '\n';
      entities.push({ type: 'bold', offset: start, length: label1.length });
    }
    {
      const label2 = 'Участников:'; const val2 = Array.isArray(archivedRoom?.members) ? archivedRoom.members.length : '—';
      const start = text.length; const line = `${label2} ${val2}`; text += line + '\n\n';
      entities.push({ type: 'bold', offset: start, length: label2.length });
    }

    // 5) Если пользователь найден в архиве — выводим ответы/оценки
    if (archivedRoom && participantFromArchive) {
      // 🧠 Ответы на вопросы
      if (Array.isArray(participantFromArchive.questions_answers) && participantFromArchive.questions_answers.length) {
        const label = '🧠 Ответы на вопросы:';
        const start = text.length; text += label + '\n';
        entities.push({ type: 'bold', offset: start, length: label.length });
        participantFromArchive.questions_answers.forEach((ans, i) => {
          const t = String(ans ?? '').trim().replace(/\s+/g, ' ');
          text += `${i + 1}. ${t}\n`;
        });
        text += '\n';
      }

      // 📈 Средние доли по капиталам
      if (archivedRoom?.result?.capitals && archivedRoom?.members?.length) {
        const label = 'Средние доли по капиталам';
        const start = text.length; text += label + '\n';
        entities.push({ type: 'bold', offset: start, length: label.length });

        for (const m of archivedRoom.members) {
          const caps = archivedRoom.result.capitals[m] || { econ: 0, human: 0, social: 0 };
          text += `• ${m}\n`;
          const line1 = `Экон ${pad((caps.econ ?? 0).toFixed(1))} %  ${bar(caps.econ)}`;
          const l1s = text.length; text += line1 + '\n'; entities.push({ type: 'code', offset: l1s, length: line1.length });
          const line2 = `Чел  ${pad((caps.human ?? 0).toFixed(1))} %  ${bar(caps.human)}`;
          const l2s = text.length; text += line2 + '\n'; entities.push({ type: 'code', offset: l2s, length: line2.length });
          const line3 = `Соц  ${pad((caps.social ?? 0).toFixed(1))} %  ${bar(caps.social)}`;
          const l3s = text.length; text += line3 + '\n\n'; entities.push({ type: 'code', offset: l3s, length: line3.length });
        }
      }

      if (archivedRoom?.result?.shares?.length) {
        const label = 'Итоговые доли';
        const start = text.length; text += label + '\n';
        entities.push({ type: 'bold', offset: start, length: label.length });
        for (const s of archivedRoom.result.shares) {
          const nm = String(s.name ?? '').trim().replace(/\s+/g, ' ');
          text += `• ${nm}: ${s.share}%\n`;
        }
      } else {
        text += 'Тест ещё не проходил.\n\n';
      }
    } else {
      text += 'Тест ещё не проходил.\n\n';
    }

    const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
    const options = { disable_web_page_preview: true, entities };
    if (hasUsername) {
      options.reply_markup = { inline_keyboard: [[{ text: '👤 Открыть профиль', url: `https://t.me/${user.username}` }]] };
    }
    await bot.sendMessage(GROUP_CHAT_ID, text, options);

    return res.json({ success: true });
  } catch (error) {
    console.error('Ошибка при отправке заявки на разбор:', error);
    return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
};