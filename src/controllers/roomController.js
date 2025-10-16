import { Room } from "../models/Room.js";

// ─────────────────────────────────────────────
// ✅ Создать комнату
// ─────────────────────────────────────────────
// Body:
// {
//   "maxMembers": 3,
//   "members": ["Alex", "Vlad", "Max"]
// }
export const createRoom = async (req, res) => {
  try {
    const { maxMembers, members } = req.body;

    if (![2, 3].includes(maxMembers)) {
      return res.status(400).json({ error: "maxMembers может быть только 2 или 3" });
    }

    if (!Array.isArray(members) || members.length !== maxMembers) {
      return res.status(400).json({ error: "Нужно передать имена всех участников" });
    }

    const roomId = Math.random().toString(36).substring(2, 8);
    const room = new Room({ roomId, maxMembers, members, answers: [] });
    await room.save();

    // Ссылки для каждого участника
    const baseUrl = "https://app.com/join"; // поменяй на свой фронт
    const links = {};
    members.forEach((name) => {
      links[name] = `${baseUrl}/${roomId}?name=${encodeURIComponent(name)}`;
    });

    res.json({ roomId, members, links });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка при создании комнаты" });
  }
};

// ─────────────────────────────────────────────
// ✅ Добавить ответ участника
// ─────────────────────────────────────────────
// Body:
// {
//   "id": "2038669602",
//   "name": "Vlad",
//   "self_input": { "econ": 25, "human": 50, "social": 25 },
//   "partners_input": [
//       { "partnerName": "Alex", "econ": 40, "human": 40, "social": 20 },
//       { "partnerName": "Max", "econ": 35, "human": 30, "social": 35 }
//   ]
// }
export const addAnswer = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { id, name, self_input, partners_input } = req.body;

    const room = await Room.findOne({ roomId });
    if (!room) return res.status(404).json({ error: "Комната не найдена" });

    // Проверка: участник должен быть в списке members
    if (!room.members.includes(name)) {
      return res.status(400).json({ error: `Имя "${name}" не принадлежит этой комнате` });
    }

    // Проверка: уникальность id и name
    const duplicateId = room.answers.find((a) => a.id === id);
    const duplicateName = room.answers.find((a) => a.name.toLowerCase() === name.toLowerCase());

    if (duplicateId || duplicateName) {
      return res.status(400).json({ error: "Пользователь с таким ID или именем уже добавлен" });
    }

    // Проверка: лимит участников
    if (room.answers.length >= room.maxMembers) {
      return res.status(400).json({ error: "Все участники уже добавили ответы" });
    }

    // Проверка: участник не может оценить сам себя
    const selfInPartners = partners_input.some(
      (p) => p.partnerName.toLowerCase() === name.toLowerCase()
    );
    if (selfInPartners) {
      return res.status(400).json({ error: "Участник не может оценивать сам себя" });
    }

    room.answers.push({ id, name, self_input, partners_input });
    await room.save();

    res.json({
      success: true,
      message: "Ответ успешно добавлен",
      current: room.answers.length,
      total: room.maxMembers,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка при добавлении ответа" });
  }
};

// ─────────────────────────────────────────────
// ✅ Получить комнату
// ─────────────────────────────────────────────
export const getRoom = async (req, res) => {
  try {
    const { roomId } = req.params;
    const room = await Room.findOne({ roomId });
    if (!room) return res.status(404).json({ error: "Комната не найдена" });
    res.json(room);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Ошибка при получении комнаты" });
  }
};