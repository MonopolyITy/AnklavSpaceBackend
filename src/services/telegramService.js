// bot.js
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { User } from '../models/User.js';

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
