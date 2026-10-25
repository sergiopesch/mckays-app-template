/*
<ai_context>
Contains server actions related to todos in the DB.
</ai_context>
*/

"use server"

import { db } from "@/db/db"
import { auth } from "@clerk/nextjs/server"
import { InsertTodo, SelectTodo, todosTable } from "@/db/schema/todos-schema"
import { ActionState } from "@/types"
import { and, eq } from "drizzle-orm"

export async function createTodoAction(
  todo: InsertTodo
): Promise<ActionState<SelectTodo>> {
  try {
    const { userId } = await auth()
    if (!userId || todo.userId !== userId) {
      return { isSuccess: false, message: "Unauthorized" }
    }

    const [newTodo] = await db.insert(todosTable).values({ userId, content: todo.content, completed: todo.completed }).returning()
    return {
      isSuccess: true,
      message: "Todo created successfully",
      data: newTodo
    }
  } catch (error) {
    console.error("Error creating todo:", error)
    return { isSuccess: false, message: "Failed to create todo" }
  }
}

export async function getTodosAction(
  userId: string
): Promise<ActionState<SelectTodo[]>> {
  try {
    const actor = await auth()
    if (!actor.userId || actor.userId !== userId) {
      return { isSuccess: false, message: "Unauthorized" }
    }

    const todos = await db.query.todos.findMany({
      where: eq(todosTable.userId, userId)
    })
    return {
      isSuccess: true,
      message: "Todos retrieved successfully",
      data: todos
    }
  } catch (error) {
    console.error("Error getting todos:", error)
    return { isSuccess: false, message: "Failed to get todos" }
  }
}

export async function updateTodoAction(
  id: string,
  data: Partial<InsertTodo>
): Promise<ActionState<SelectTodo>> {
  try {
    const { userId } = await auth()
    if (!userId || (data.userId !== undefined && data.userId !== userId)) {
      return { isSuccess: false, message: "Unauthorized" }
    }
    if (Object.keys(data).some((key) => !["content", "completed", "userId"].includes(key))) {
      return { isSuccess: false, message: "Invalid todo update" }
    }
    const changes: Partial<InsertTodo> = {}
    if (data.content !== undefined) changes.content = data.content
    if (data.completed !== undefined) changes.completed = data.completed
    if (!Object.keys(changes).length) {
      return { isSuccess: false, message: "No todo changes provided" }
    }

    const [updatedTodo] = await db
      .update(todosTable)
      .set(changes)
      .where(and(eq(todosTable.id, id), eq(todosTable.userId, userId)))
      .returning()

    return {
      isSuccess: true,
      message: "Todo updated successfully",
      data: updatedTodo
    }
  } catch (error) {
    console.error("Error updating todo:", error)
    return { isSuccess: false, message: "Failed to update todo" }
  }
}

export async function deleteTodoAction(id: string): Promise<ActionState<void>> {
  try {
    const { userId } = await auth()
    if (!userId) return { isSuccess: false, message: "Unauthorized" }

    await db.delete(todosTable).where(and(eq(todosTable.id, id), eq(todosTable.userId, userId)))
    return {
      isSuccess: true,
      message: "Todo deleted successfully",
      data: undefined
    }
  } catch (error) {
    console.error("Error deleting todo:", error)
    return { isSuccess: false, message: "Failed to delete todo" }
  }
}
