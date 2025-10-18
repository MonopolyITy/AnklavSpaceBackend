import mongoose from "mongoose";

// ─────────────────────────────────────────────
// Схема для оценок партнёров
// ─────────────────────────────────────────────
const partnerSchema = new mongoose.Schema({
  partnerName: String, // только имя партнёра
  econ: Number,
  human: Number,
  social: Number,
});

// ─────────────────────────────────────────────
// Схема для ответа участника
// ─────────────────────────────────────────────
const answerSchema = new mongoose.Schema({
  id: String,   // уникальный userId
  name: String, // имя пользователя
  questions_answers: [String], 
  self_input: {
    econ: Number,
    human: Number,
    social: Number,
  },
  partners_input: [partnerSchema], // оценки его партнёров
});
// ─────────────────────────────────────────────
// Основная схема комнаты
// ─────────────────────────────────────────────
const roomSchema = new mongoose.Schema({
  roomId: { type: String, required: true, unique: true },
  maxMembers: { type: Number, enum: [2, 3], required: true },
  members: [String], // просто имена участников
  answers: [answerSchema],
  createdAt: { type: Date, default: Date.now },
});

export const Room = mongoose.model("Room", roomSchema);