import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

import {connectDB} from './config/db.js';
import bot from './services/telegramService.js'

import checkRoute from './routes/checkRoute.js'
import roomRoutes from "./routes/roomRoutes.js";
import bidRoutes from "./routes/bidRoutes.js";

connectDB();

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/check', checkRoute);
app.use("/api/rooms", roomRoutes);
app.use("/api/bid", bidRoutes);



export default app;