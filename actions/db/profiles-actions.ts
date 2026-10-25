/*
<ai_context>
Contains server actions related to profiles in the DB.
</ai_context>
*/

"use server"

import { db } from "@/db/db"
import { auth } from "@clerk/nextjs/server"
import {
  InsertProfile,
  profilesTable,
  SelectProfile
} from "@/db/schema/profiles-schema"
import { ActionState } from "@/types"
import { eq } from "drizzle-orm"

export async function createProfileAction(
  data: Pick<InsertProfile, "userId">
): Promise<ActionState<SelectProfile>> {
  try {
    const { userId } = await auth()
    if (!userId || data.userId !== userId || Object.keys(data).some((key) => key !== "userId")) {
      return { isSuccess: false, message: "Unauthorized profile creation" }
    }

    const [newProfile] = await db.insert(profilesTable).values({ userId }).returning()
    return {
      isSuccess: true,
      message: "Profile created successfully",
      data: newProfile
    }
  } catch (error) {
    console.error("Error creating profile:", error)
    return { isSuccess: false, message: "Failed to create profile" }
  }
}

export async function getProfileByUserIdAction(
  userId: string
): Promise<ActionState<SelectProfile>> {
  try {
    const actor = await auth()
    if (!actor.userId || actor.userId !== userId) {
      return { isSuccess: false, message: "Unauthorized" }
    }

    const profile = await db.query.profiles.findFirst({
      where: eq(profilesTable.userId, userId)
    })
    if (!profile) {
      return { isSuccess: false, message: "Profile not found" }
    }

    return {
      isSuccess: true,
      message: "Profile retrieved successfully",
      data: profile
    }
  } catch (error) {
    console.error("Error getting profile by user id", error)
    return { isSuccess: false, message: "Failed to get profile" }
  }
}

export async function deleteProfileAction(
  userId: string
): Promise<ActionState<void>> {
  try {
    const actor = await auth()
    if (!actor.userId || actor.userId !== userId) {
      return { isSuccess: false, message: "Unauthorized" }
    }

    await db.delete(profilesTable).where(eq(profilesTable.userId, userId))
    return {
      isSuccess: true,
      message: "Profile deleted successfully",
      data: undefined
    }
  } catch (error) {
    console.error("Error deleting profile:", error)
    return { isSuccess: false, message: "Failed to delete profile" }
  }
}
