import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";
import { TaskPriority, TaskStatus } from "@prisma/client";

const statusValues = new Set<string>(Object.values(TaskStatus));
const priorityValues = new Set<string>(Object.values(TaskPriority));

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return unauthorized();
  }

  try {
    const tasks = await prisma.task.findMany({
      where: {
        owner: {
          email: session.user.email,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json(tasks);
  } catch (error) {
    console.error("Failed to load tasks", error);
    return NextResponse.json(
      { error: "Unable to load tasks" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
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

  if (!title || typeof title !== "string" || title.trim().length === 0) {
    return badRequest("A task title is required");
  }

  const parsedDescription =
    typeof description === "string" && description.trim().length > 0
      ? description.trim()
      : null;

  const resolvedStatus =
    status === undefined
      ? TaskStatus.TODO
      : typeof status === "string" && statusValues.has(status)
        ? (status as TaskStatus)
        : null;

  if (!resolvedStatus) {
    return badRequest("Invalid task status provided");
  }

  const resolvedPriority =
    priority === undefined
      ? TaskPriority.MEDIUM
      : typeof priority === "string" && priorityValues.has(priority)
        ? (priority as TaskPriority)
        : null;

  if (!resolvedPriority) {
    return badRequest("Invalid task priority provided");
  }

  let parsedDueDate: Date | null = null;

  if (dueDate !== undefined && dueDate !== null && dueDate !== "") {
    if (typeof dueDate !== "string") {
      return badRequest("Due date must be a string in ISO format");
    }

    const due = new Date(dueDate);

    if (Number.isNaN(due.getTime())) {
      return badRequest("Invalid due date provided");
    }

    parsedDueDate = due;
  }

  try {
    const owner = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });

    if (!owner) {
      return unauthorized();
    }

    const task = await prisma.task.create({
      data: {
        title: title.trim(),
        description: parsedDescription,
        status: resolvedStatus,
        priority: resolvedPriority,
        dueDate: parsedDueDate,
        ownerId: owner.id,
      },
    });

    return NextResponse.json(task, { status: 201 });
  } catch (error) {
    console.error("Failed to create task", error);
    return NextResponse.json(
      { error: "Unable to create task" },
      { status: 500 },
    );
  }
}
