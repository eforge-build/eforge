import express from 'express';
import { todosRouter } from './routes/todos.js';

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/todos', todosRouter);
  return app;
}
