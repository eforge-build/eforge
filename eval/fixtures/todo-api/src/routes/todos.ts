import { Router } from 'express';
import { getAllTodos, getTodoById, createTodo, updateTodo, deleteTodo } from '../db.js';

export const todosRouter = Router();

todosRouter.get('/', (_req, res) => {
  res.json(getAllTodos());
});

todosRouter.get('/:id', (req, res) => {
  const todo = getTodoById(req.params.id);
  if (!todo) {
    res.status(404).json({ error: 'Todo not found' });
    return;
  }
  res.json(todo);
});

todosRouter.post('/', (req, res) => {
  const { title } = req.body;
  if (!title || typeof title !== 'string') {
    res.status(400).json({ error: 'Title is required' });
    return;
  }
  const todo = createTodo(title);
  res.status(201).json(todo);
});

todosRouter.patch('/:id', (req, res) => {
  const { title, completed } = req.body;
  if (title !== undefined && typeof title !== 'string') {
    res.status(400).json({ error: 'Title must be a string' });
    return;
  }
  if (completed !== undefined && typeof completed !== 'boolean') {
    res.status(400).json({ error: 'Completed must be a boolean' });
    return;
  }
  const todo = updateTodo(req.params.id, { title, completed });
  if (!todo) {
    res.status(404).json({ error: 'Todo not found' });
    return;
  }
  res.json(todo);
});

todosRouter.delete('/:id', (req, res) => {
  const deleted = deleteTodo(req.params.id);
  if (!deleted) {
    res.status(404).json({ error: 'Todo not found' });
    return;
  }
  res.status(204).send();
});
