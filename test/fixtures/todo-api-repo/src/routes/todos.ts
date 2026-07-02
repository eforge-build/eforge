import { Router } from 'express';

export interface Todo {
  id: string;
  title: string;
  completed: boolean;
}

const todos = new Map<string, Todo>();

export const todosRouter = Router();

todosRouter.get('/', (_req, res) => {
  res.json([...todos.values()]);
});

todosRouter.post('/', (req, res) => {
  const id = crypto.randomUUID();
  const todo: Todo = { id, title: String(req.body.title ?? ''), completed: false };
  todos.set(id, todo);
  res.status(201).json(todo);
});

todosRouter.get('/:id', (req, res) => {
  const todo = todos.get(req.params.id);
  if (!todo) return res.status(404).json({ error: 'not found' });
  res.json(todo);
});

todosRouter.delete('/:id', (req, res) => {
  todos.delete(req.params.id);
  res.status(204).end();
});
