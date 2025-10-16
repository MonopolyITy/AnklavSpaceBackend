import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

import {connectDB} from './config/db.js';
import bot from './services/telegramService.js'

import checkRoute from './routes/checkRoute.js'
import roomRoutes from "./routes/roomRoutes.js";

connectDB();

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/check', checkRoute);
app.use("/api/rooms", roomRoutes);



export default app;