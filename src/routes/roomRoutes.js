import express from "express";
import { createRoom, addAnswer, getRoom } from "../controllers/roomController.js";

const router = express.Router();

router.post("/create", createRoom);
router.post("/:roomId/answer", addAnswer);
router.get("/:roomId", getRoom);

export default router;