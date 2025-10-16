import express from 'express';
import { checkUser } from '../controllers/checkController.js'

const router = express.Router();

router.post('/user', checkUser);

export default router;