import { describe, it, expect, beforeEach } from 'vitest';
import { clearTodos, createTodo, getAllTodos, getTodoById, updateTodo, deleteTodo } from '../src/db.js';

describe('Todo DB', () => {
  beforeEach(() => {
    clearTodos();
  });

  it('creates a todo', () => {
    const todo = createTodo('Buy groceries');
    expect(todo.title).toBe('Buy groceries');
    expect(todo.completed).toBe(false);
    expect(todo.id).toBeDefined();
  });

  it('lists all todos', () => {
    createTodo('First');
    createTodo('Second');
    const todos = getAllTodos();
    expect(todos).toHaveLength(2);
  });

  it('gets a todo by id', () => {
    const created = createTodo('Test');
    const found = getTodoById(created.id);
    expect(found).toEqual(created);
  });

  it('returns undefined for missing todo', () => {
    expect(getTodoById('999')).toBeUndefined();
  });

  it('updates a todo', () => {
    const todo = createTodo('Update me');
    const updated = updateTodo(todo.id, { completed: true });
    expect(updated?.completed).toBe(true);
    expect(updated?.title).toBe('Update me');
  });

  it('deletes a todo', () => {
    const todo = createTodo('Delete me');
    expect(deleteTodo(todo.id)).toBe(true);
    expect(getAllTodos()).toHaveLength(0);
  });

  it('returns false when deleting missing todo', () => {
    expect(deleteTodo('999')).toBe(false);
  });
});
