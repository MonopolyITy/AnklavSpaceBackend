import mongoose from "mongoose";

const archivedRoomSchema = new mongoose.Schema({
  roomId: String,
  maxMembers: Number,
  members: [String],
  answers: Array,
  result: Object, // можно хранить финальный расчёт (weights, capitals, shares)
  archivedAt: { type: Date, default: Date.now },
});

export const ArchivedRoom = mongoose.model("ArchivedRoom", archivedRoomSchema);