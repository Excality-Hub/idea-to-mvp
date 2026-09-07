# Idea: Todo list app

Build a small todo app on top of the existing Express server.

- `GET /todos` returns the current list of todos as JSON.
- `POST /todos` accepts `{ "title": string }` and adds a new todo with
  `done: false`.
- `POST /todos/:id/done` marks a todo as done.
- Todos can be stored in memory (no database needed).
