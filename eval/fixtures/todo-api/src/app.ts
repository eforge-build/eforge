import express from 'express';
import { todosRouter } from './routes/todos.js';

export const app = express();

app.use(express.json());
app.use('/todos', todosRouter);
