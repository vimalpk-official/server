import express from "express";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import cors from "cors";
import multer from "multer";
import { ObjectId } from "mongodb";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 7000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

const uri = process.env.MONGO_URI;
const dbName = process.env.DB_NAME;
const collectionName = process.env.COLLECTION_NAME;

// Validate environment variables
if (!uri || !dbName || !collectionName) {
  console.error("Missing required environment variables:");
  console.error("MONGO_URI:", !!uri);
  console.error("DB_NAME:", !!dbName);
  console.error("COLLECTION_NAME:", !!collectionName);
  process.exit(1);
}

async function connectToMongoDB() {
  try {
    const client = new MongoClient(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    await client.connect();
    console.log("✅ Connected to MongoDB");
    return client;
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    throw error;
  }
}

app.post("/login/validation", async (req, res) => {
  console.log("🔔 Validation endpoint hit");

  const { email } = req.body;
  console.log("Received email from frontend:", email);

  try {
    const client = await connectToMongoDB(); // Assuming this returns a connected MongoClient
    const db = client.db(dbName);
    const collection = db.collection(collectionName);

    // Search for the email across all team members
    const memberExists = await collection.findOne({
      "teams.members.memberID.email": email,
    });

    if (memberExists) {
      console.log("✅ Email found in the database.");
      return res
        .status(200)
        .json({ status: "success", message: "Email exists." });
    } else {
      console.log("❌ Email does not exist in any team.");
      return res
        .status(404)
        .json({ status: "fail", message: "Email does not exist." });
    }
  } catch (error) {
    console.error("🔥 Error during validation:", error);
    return res
      .status(500)
      .json({ status: "error", message: "Internal server error." });
  }
});

// GET route to fetch all data
app.get("/api/calldata", async (req, res) => {
  console.log("📥 Client triggered the API call data");
  let client;
  try {
    client = await connectToMongoDB();
    const db = client.db(dbName);
    const collection = db.collection(collectionName);
    const allDocs = await collection.find({}).toArray();
    console.log("📊 Data retrieved from MongoDB:", allDocs.length, "documents");

    res.status(200).json({
      success: true,
      teams: [
        {
          members: allDocs,
        },
      ],
    });
  } catch (error) {
    console.error("❌ Error retrieving data:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  } finally {
    if (client) {
      await client.close();
      console.log("🔒 MongoDB connection closed");
    }
  }
});

app.post("/save/data", upload.single("profilePic"), async (req, res) => {
  console.log("💾 Save data endpoint triggered");
  let client;

  // Define teamOptions if not already defined elsewhere
  const teamOptions = [
    { value: "634eefb4b35a8abf6acbdd3a", label: "HR & Finance" },
    { value: "634eefb4b35a8abf6acbdd2c", label: "Technology" },
    // Add more team options as needed
  ];

  try {
    const formData = req.body;
    const imageFile = req.file;

    console.log("📝 Form Data:", formData);
    console.log("🖼️ Uploaded File:", imageFile ? "File received" : "No file");

    // Validate required fields
    if (!formData.name || !formData.email || !formData.teamIds) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: name, email, or teamIds",
      });
    }

    // Process image
    let profilePictureData = null;
    if (imageFile) {
      profilePictureData = {
        data: imageFile.buffer.toString("base64"),
        contentType: imageFile.mimetype,
        filename: imageFile.originalname,
        size: imageFile.size,
      };
    }

    // Parse teamIds if it's a string
    let teamIds = formData.teamIds;
    if (typeof teamIds === "string") {
      try {
        teamIds = JSON.parse(teamIds);
      } catch (e) {
        teamIds = [teamIds]; // If it's not valid JSON, treat as single ID
      }
    }

    // Parse teamNames if it's a string
    let teamNames = formData.teamNames;
    if (typeof teamNames === "string") {
      try {
        teamNames = JSON.parse(teamNames);
      } catch (e) {
        teamNames = [teamNames];
      }
    }

    // Map team names from teamIds - use formData.teamNames if available, otherwise use teamOptions
    const mappedTeams = teamIds.map((teamId, index) => {
      // First try to use the provided teamNames
      if (teamNames && teamNames[index]) {
        return {
          _id: teamId,
          name: teamNames[index],
        };
      }

      // Fallback to teamOptions lookup
      const team = teamOptions.find((option) => option.value === teamId);
      return {
        _id: teamId,
        name: team ? team.label : "Unknown Team",
      };
    });

    console.log(mappedTeams, "mapped teams");

    const memberData = {
      memberID: {
        _id: new ObjectId().toString(),
        name: formData.name,
        email: formData.email,
        ...(profilePictureData && { profilePicture: profilePictureData }),
        bio: formData.content || "",
        designation: formData.designation || "",
        team: mappedTeams,
        doj: formData.doj || "",
        dob: formData.dob || "",
        yoe: formData.yoe || "",
        designationText: formData.designation || "",
        createdAt: new Date(),
        updatedAt: new Date(),
        __v: 0,
      },
    };

    console.log(memberData, "member");

    const allTeamId = "634eefb4b35a8abf6acbdd2a";

    client = await connectToMongoDB();
    const db = client.db(dbName);
    const collection = db.collection(collectionName);

    let updatedTeamCount = 0;
    let teamUpdateResults = [];

    // Update specific teams
    for (const teamId of teamIds) {
      const result = await collection.updateOne(
        { "teams._id": teamId },
        {
          $push: { "teams.$.members": memberData },
          $set: { updatedAt: new Date() },
        }
      );

      teamUpdateResults.push({
        teamId: teamId,
        success: result.modifiedCount > 0,
        modifiedCount: result.modifiedCount,
      });

      if (result.modifiedCount > 0) updatedTeamCount++;
    }

    // Update "All" team
    const result2 = await collection.updateOne(
      { "teams._id": allTeamId },
      {
        $push: { "teams.$.members": memberData },
        $set: { updatedAt: new Date() },
      }
    );

    console.log("✅ Data saved to MongoDB");
    console.log("📊 Team update results:", teamUpdateResults);
    console.log("🔄 All team update result:", result2.modifiedCount);

    res.status(200).json({
      success: true,
      message: "Member data saved successfully",
      results: {
        specificTeams:
          updatedTeamCount > 0
            ? `${updatedTeamCount} teams updated`
            : "No teams matched",
        allTeam: result2.modifiedCount > 0 ? "Success" : "All team not found",
        teamUpdateDetails: teamUpdateResults,
      },
      memberData: memberData,
    });
  } catch (error) {
    console.error("❌ Error saving data:", error);
    res.status(500).json({
      success: false,
      message: "Failed to save member data",
      error: error.message,
    });
  } finally {
    if (client) {
      await client.close();
      console.log("🔒 MongoDB connection closed");
    }
  }
  x;
});

// FIXED DELETE route to remove a member
app.delete("/delete/member", async (req, res) => {
  console.log("🗑️ Delete member endpoint triggered");
  let client;

  try {
    const memberIdToDelete = req.body.key;

    // Validate input
    if (!memberIdToDelete) {
      return res.status(400).json({
        success: false,
        message: "Member ID (key) is required.",
      });
    }

    console.log("🔍 Attempting to delete member with ID:", memberIdToDelete);

    client = await connectToMongoDB();
    const db = client.db(dbName);
    const collection = db.collection(collectionName);

    // First, check if the member exists
    const memberExists = await collection.findOne({
      "teams.members.memberID._id": memberIdToDelete,
    });

    if (!memberExists) {
      console.log("❌ Member not found in database");
      return res.status(404).json({
        success: false,
        message: "Member not found in any team.",
      });
    }

    console.log("✅ Member found, proceeding with deletion");

    // Delete the member from all teams using correct query path
    const result = await collection.updateMany(
      { "teams.members.memberID._id": memberIdToDelete },
      {
        $pull: {
          "teams.$[].members": { "memberID._id": memberIdToDelete },
        },
        $set: {
          updatedAt: new Date(),
        },
      }
    );

    console.log("🔄 Delete operation result:", {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    });

    if (result.modifiedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Member not found or could not be removed.",
      });
    }

    console.log("✅ Member successfully removed from all teams");
    res.status(200).json({
      success: true,
      message: "Member successfully removed from all teams.",
      modifiedCount: result.modifiedCount,
      matchedCount: result.matchedCount,
    });
  } catch (err) {
    console.error("❌ Error deleting member:", err);
    res.status(500).json({
      success: false,
      message: "Internal server error.",
      error: err.message,
    });
  } finally {
    if (client) {
      await client.close();
      console.log("🔒 MongoDB connection closed.");
    }
  }
});

// Fixed Update Member API
app.post("/update/member", upload.single("profilePic"), async (req, res) => {
  const formData = req.body;
  const memberIdToUpdate = formData.importance;

  // Parse teamIds from formData (assuming it comes as a string or array)
  let teamIds = [];
  if (formData.teamIds) {
    teamIds = Array.isArray(formData.teamIds)
      ? formData.teamIds
      : JSON.parse(formData.teamIds);
  }

  console.log("Form Data:", formData);
  console.log("Team IDs:", teamIds);

  let client;

  try {
    // Validation
    if (!memberIdToUpdate) {
      return res.status(400).json({
        success: false,
        message: "Member ID is required",
      });
    }

    if (!formData.name || !formData.email) {
      return res.status(400).json({
        success: false,
        message: "Name and email are required fields",
      });
    }

    if (!teamIds || teamIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one team ID is required",
      });
    }

    client = await connectToMongoDB();
    const db = client.db(dbName);
    const collection = db.collection(collectionName);

    // Find the document that contains the member to update
    const documentWithMember = await collection.findOne({
      "teams.members.memberID._id": memberIdToUpdate,
    });

    if (!documentWithMember) {
      return res.status(404).json({
        success: false,
        message: "Member not found in any team",
      });
    }

    // Find the existing member data
    let foundMember = null;
    for (const team of documentWithMember.teams) {
      const member = team.members.find(
        (m) => m.memberID._id === memberIdToUpdate
      );
      if (member) {
        foundMember = member;
        break;
      }
    }

    if (!foundMember) {
      return res.status(404).json({
        success: false,
        message: "Member not found in teams",
      });
    }

    // Process image if uploaded
    let profilePictureData = foundMember.memberID.profilePicture || "";
    const imageFile = req.file;

    if (imageFile) {
      profilePictureData = {
        data: imageFile.buffer.toString("base64"),
        contentType: imageFile.mimetype,
        filename: imageFile.originalname,
        size: imageFile.size,
      };
    }

    // Build team array for the member
    const teamArray = teamIds.map((teamId) => ({
      name: getTeamNameById(documentWithMember.teams, teamId),
      _id: teamId,
    }));

    // Build the updated member object
    const updatedMember = {
      _id: memberIdToUpdate,
      name: formData.name,
      email: formData.email,
      isActive: foundMember.memberID.isActive || true,
      created_by: foundMember.memberID.created_by || "",
      profilePicture: profilePictureData,
      bio: formData.about || foundMember.memberID.bio || "",
      designation:
        formData.designation || foundMember.memberID.designation || "",
      team: teamArray,
      doj: formData.doj || foundMember.memberID.doj || "",
      dob: formData.dob || foundMember.memberID.dob || "",
      yoe: formData.yoe || foundMember.memberID.yoe || "",
      designationText:
        formData.designationText ||
        formData.designation ||
        foundMember.memberID.designationText ||
        "",
      createdAt: foundMember.memberID.createdAt || new Date(),
      updatedAt: new Date(),
      __v: foundMember.memberID.__v || 0,
    };

    console.log("Updated member data:", updatedMember);

    // Step 1: Remove member from all teams first
    await collection.updateMany(
      { "teams.members.memberID._id": memberIdToUpdate },
      {
        $pull: {
          "teams.$[].members": { "memberID._id": memberIdToUpdate },
        },
        $set: { updatedAt: new Date() },
      }
    );

    // Step 2: Add/Update member in specified teams
    const teamUpdateResults = [];
    let updatedTeamCount = 0;

    // Use the existing member's _id for consistency across all teams
    const memberEntryId = foundMember._id;

    for (const teamId of teamIds) {
      // Check if team exists in the document
      const teamExists = documentWithMember.teams.some(
        (team) => team._id === teamId
      );

      if (!teamExists) {
        console.log(`Team ${teamId} not found in document`);
        teamUpdateResults.push({
          teamId: teamId,
          success: false,
          message: "Team not found",
        });
        continue;
      }

      // Create member data structure with same _id
      const memberData = {
        memberID: updatedMember,
        _id: memberEntryId, // Use the same _id for all team entries
      };

      // Add member to the specific team
      const result = await collection.updateOne(
        { "teams._id": teamId },
        {
          $push: { "teams.$.members": memberData },
          $set: { updatedAt: new Date() },
        }
      );

      teamUpdateResults.push({
        teamId: teamId,
        success: result.modifiedCount > 0,
        modifiedCount: result.modifiedCount,
      });

      if (result.modifiedCount > 0) updatedTeamCount++;
    }

    if (updatedTeamCount === 0) {
      return res.status(400).json({
        success: false,
        message: "Failed to update member in any team",
        teamResults: teamUpdateResults,
      });
    }

    console.log("✅ Member updated successfully");
    res.status(200).json({
      success: true,
      message: `Member updated successfully in ${updatedTeamCount} team(s)`,
      data: updatedMember,
      teamResults: teamUpdateResults,
    });
  } catch (error) {
    console.error("❌ Error updating member:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  } finally {
    if (client) {
      await client.close();
      console.log("🔒 MongoDB connection closed");
    }
  }
});

// Helper function to get team name by ID
function getTeamNameById(teams, teamId) {
  const team = teams.find((t) => t._id === teamId);
  return team ? team.name : "Unknown Team";
}

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is healthy",
    timestamp: new Date().toISOString(),
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("🚨 Unhandled error:", err);
  res.status(500).json({
    success: false,
    message: "Internal server error",
    error:
      process.env.NODE_ENV === "development"
        ? err.message
        : "Something went wrong",
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📊 Health check available at http://localhost:${PORT}/health`);
});
