import { User } from '../models/User.js';

export const checkUser = async (req, res) => {
  try {
    const { user } = req.body;

    if (!user?.id) {
      return res.status(400).json({ message: 'Invalid user data' });
    }

    let dbUser = await User.findOne({ telegramId: user.id });

    if (!dbUser) {
      dbUser = new User({
        telegramId:   user.id,
        username:     user.username      ?? '',
        firstName:    user.first_name    ?? '',
        lastName:     user.last_name     ?? '',
        languageCode: user.language_code ?? ''
      });
      await dbUser.save();
    }

    return res.status(200).json({ message: '✅ User is in the database' });
  } catch (err) {
    console.error('Telegram login error:', err);
    return res.status(500).json({ message: '❌ Internal server error' });
  }
};
