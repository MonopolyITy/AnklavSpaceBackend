import express from "express";
import { sendBidMessage } from "../controllers/bidController.js";

const router = express.Router();

// POST /api/bid
router.post("/", sendBidMessage);

export default router;