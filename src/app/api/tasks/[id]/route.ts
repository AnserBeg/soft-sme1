import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";
import { TaskPriority, TaskStatus } from "@prisma/client";

const statusValues = new Set<string>(Object.values(TaskStatus));
const priorityValues = new Set<string>(Object.values(TaskPriority));

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function notFound() {
  return NextResponse.json({ error: "Task not found" }, { status: 404 });
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

async function getCurrentUserId() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });

  return user?.id ?? null;
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const userId = await getCurrentUserId();

  if (!userId) {
    return unauthorized();
  }

  try {
    const task = await prisma.task.findUnique({
      where: { id: params.id },
    });

    if (!task || task.ownerId !== userId) {
      return notFound();
    }

    return NextResponse.json(task);
  } catch (error) {
    console.error("Failed to load task", error);
    return NextResponse.json(
      { error: "Unable to load task" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const userId = await getCurrentUserId();

  if (!userId) {
    return unauthorized();
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch (error) {
    return badRequest("Invalid JSON payload");
  }

  if (!body || typeof body !== "object") {
    return badRequest("Request body is required");
  }

  const { title, description, status, priority, dueDate } = body as {
    title?: unknown;
    description?: unknown;
    status?: unknown;
    priority?: unknown;
    dueDate?: unknown;
  };

  const updateData: Record<string, unknown> = {};

  if (title !== undefined) {
    if (typeof title !== "string" || title.trim().length === 0) {
      return badRequest("Title must be a non-empty string");
    }

    updateData.title = title.trim();
  }

  if (description !== undefined) {
    if (description === null || description === "") {
      updateData.description = null;
    } else if (typeof description === "string") {
      updateData.description = description.trim();
    } else {
      return badRequest("Description must be a string");
    }
  }

  if (status !== undefined) {
    if (typeof status !== "string" || !statusValues.has(status)) {
      return badRequest("Invalid task status provided");
    }

    updateData.status = status;
  }

  if (priority !== undefined) {
    if (typeof priority !== "string" || !priorityValues.has(priority)) {
      return badRequest("Invalid task priority provided");
    }

    updateData.priority = priority;
  }

  if (dueDate !== undefined) {
    if (dueDate === null || dueDate === "") {
      updateData.dueDate = null;
    } else if (typeof dueDate === "string") {
      const due = new Date(dueDate);

      if (Number.isNaN(due.getTime())) {
        return badRequest("Invalid due date provided");
      }

      updateData.dueDate = due;
    } else {
      return badRequest("Due date must be a string in ISO format");
    }
  }

  if (Object.keys(updateData).length === 0) {
    return badRequest("No updates provided");
  }

  try {
    const existingTask = await prisma.task.findUnique({
      where: { id: params.id },
      select: { ownerId: true },
    });

    if (!existingTask || existingTask.ownerId !== userId) {
      return notFound();
    }

    const updatedTask = await prisma.task.update({
      where: { id: params.id },
      data: updateData,
    });

    return NextResponse.json(updatedTask);
  } catch (error) {
    console.error("Failed to update task", error);
    return NextResponse.json(
      { error: "Unable to update task" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const userId = await getCurrentUserId();

  if (!userId) {
    return unauthorized();
  }

  try {
    const existingTask = await prisma.task.findUnique({
      where: { id: params.id },
      select: { ownerId: true },
    });

    if (!existingTask || existingTask.ownerId !== userId) {
      return notFound();
    }

    await prisma.task.delete({
      where: { id: params.id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete task", error);
    return NextResponse.json(
      { error: "Unable to delete task" },
      { status: 500 },
    );
  }
}
