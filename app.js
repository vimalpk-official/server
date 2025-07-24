import express from "express";
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv";
import cors from "cors";
import multer from "multer";
import nodemailer from "nodemailer";
import path from "path";
import fs from "fs"; // ✅ Added
import { fileURLToPath } from "url";
import { dirname } from "path";

// Fix for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 7000;
const API_ENDPOINT = process.env.API_ENDPOINT;

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, "uploads");

    // Ensure uploads folder exists
    fs.mkdirSync(uploadPath, { recursive: true });

    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const dateStamp = new Date().toISOString().split("T")[0]; // e.g., "2025-07-21"
    const ext = path.extname(file.originalname); // preserve original extension
    const baseName = path.basename(file.originalname, ext); // remove extension
    cb(null, `${baseName}-${dateStamp}${ext}`);
  },
});

const upload = multer({ storage });

// Serve static files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use(express.static(path.join(__dirname, "public")));

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(express.static(path.join(__dirname, "public")));

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

// Keep a shared client instance for reuse
let mongoClient = null;

async function connectToMongoDB() {
  if (mongoClient && mongoClient.topology?.isConnected()) {
    return mongoClient;
  }

  try {
    mongoClient = new MongoClient(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10, // ✅ Use up to 10 pooled connections (ideal for free tier)
    });

    await mongoClient.connect();
    console.log("✅ Connected to MongoDB");
    return mongoClient;
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    throw error;
  }
}

// Function to generate 6-digit code
function generateSixDigitCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const mailid = process.env.MAILID;
const mailapppassword = process.env.MAILAPPPASSWORD;

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: mailid,
    pass: mailapppassword,
  },
});

// Function to send plain text email
async function sendVerificationEmail(receiverEmail, code) {
  const mailOptions = {
    from: "socialbeatteams@gmail.com",
    to: receiverEmail,
    subject: "Login Verification Code",
    text: `Dear user,

Please use the following 6-digit code to log in to your account:

Code: ${code}


- SocialBeat Teams`,
  };

  await transporter.sendMail(mailOptions);
}

// Main route handler
app.post("/login/validation", async (req, res) => {
  const { email } = req.body;
  console.log("🔔 Validation requested for:", email);

  const HR_FINANCE_TEAM_ID = "634eefb4b35a8abf6acbdd3a";

  try {
    const client = await connectToMongoDB();
    const db = client.db(dbName);
    const collection = db.collection(collectionName);

    // Step 1: Check if member exists
    const memberExists = await collection.findOne({
      "teams.members.memberID.email": email,
    });

    if (!memberExists) {
      console.log("❌ Email not found.");
      return res.status(404).json({
        status: "fail",
        message: "Email does not exist.",
        emailExists: false,
        inHRTeam: false,
      });
    }

    // Step 2: Check if in HR/Finance team
    const memberInHRTeam = await collection.findOne({
      teams: {
        $elemMatch: {
          _id: HR_FINANCE_TEAM_ID,
          members: {
            $elemMatch: {
              "memberID.email": email,
            },
          },
        },
      },
    });

    const inHRTeam = Boolean(memberInHRTeam);

    // Step 3: Generate OTP code
    const code = generateSixDigitCode();

    // Step 4: Send verification email
    await sendVerificationEmail(email, code);
    console.log(`📧 Sent verification code to ${email}: ${code}`);

    // In your backend, use consistent naming:
    return res.status(200).json({
      status: "success",
      message: inHRTeam
        ? "Email exists and is in HR & Finance team."
        : "Email exists but not in HR & Finance team.",
      emailExists: true,
      inHRTeam,
      codeSent: true,
      devCode: code, // ✅ Keep this consistent with frontend
    });
  } catch (error) {
    console.error("🔥 Error during validation:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error.",
    });
  }
});

// --- Route: OTP Verify ---
app.post("/login/verify-otp", async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res
      .status(400)
      .json({ status: "fail", message: "Email and OTP required." });
  }

  const cleanEmail = email.trim().toLowerCase();
  const record = otpStore.get(cleanEmail);

  if (!record) {
    return res.status(404).json({
      status: "fail",
      message: "No OTP found or already used.",
    });
  }

  if (Date.now() > record.expiresAt) {
    otpStore.delete(cleanEmail);
    return res.status(410).json({
      status: "fail",
      message: "OTP expired.",
    });
  }

  if (record.otp !== otp) {
    return res.status(401).json({
      status: "fail",
      message: "Invalid OTP.",
    });
  }

  // Success: clear OTP so it can't be reused
  otpStore.delete(cleanEmail);

  // TODO: Create session/JWT here if needed
  return res.status(200).json({ status: "success" });
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

  const teamOptions = [
    { value: "634eefb4b35a8abf6acbdd3a", label: "HR & Finance" },
    { value: "634eefb4b35a8abf6acbdd2c", label: "Technology" },
  ];

  try {
    const formData = req.body;
    const imageFile = req.file;

    console.log("📝 Form Data:", formData);
    console.log(
      "🖼️ Uploaded File:",
      imageFile ? imageFile.filename : "No file"
    );

    // ✅ Only "name" is required, rest can be optional
    if (!formData.name) {
      return res.status(400).json({
        success: false,
        message: "Missing required field: name",
      });
    }

    // Parse teamIds and teamNames safely
    let teamIds = formData.teamIds;
    if (typeof teamIds === "string") {
      try {
        teamIds = JSON.parse(teamIds);
      } catch (e) {
        teamIds = [teamIds];
      }
    }
    if (!Array.isArray(teamIds)) {
      teamIds = [];
    }

    let teamNames = formData.teamNames;
    if (typeof teamNames === "string") {
      try {
        teamNames = JSON.parse(teamNames);
      } catch (e) {
        teamNames = [teamNames];
      }
    }
    if (!Array.isArray(teamNames)) {
      teamNames = [];
    }

    const mappedTeams = teamIds.map((teamId, index) => {
      if (teamNames[index]) {
        return {
          _id: teamId,
          name: teamNames[index],
        };
      }
      const team = teamOptions.find((option) => option.value === teamId);
      return {
        _id: teamId,
        name: team ? team.label : "Unknown Team",
      };
    });

    // ✅ Build the final image URL (served via /uploads)
    const profilePictureUrl = imageFile
      ? `${API_ENDPOINT}/${imageFile.filename}`
      : "";

    const memberData = {
      memberID: {
        _id: new ObjectId().toString(),
        name: formData.name,
        email: formData.email || "",
        profilePicture: profilePictureUrl,
        bio: formData.content || "",
        designation: formData.designation || "",
        team: mappedTeams,
        doj: formData.doj || "",
        dob: formData.dob || "",
        yoe: formData.yoe || "",
        designationText: formData.designationText || formData.designation || "",
        createdAt: new Date(),
        updatedAt: new Date(),
        __v: 0,
      },
    };

    const allTeamId = "634eefb4b35a8abf6acbdd2a";

    client = await connectToMongoDB();
    const db = client.db(dbName);
    const collection = db.collection(collectionName);

    let updatedTeamCount = 0;
    let teamUpdateResults = [];

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

    const result2 = await collection.updateOne(
      { "teams._id": allTeamId },
      {
        $push: { "teams.$.members": memberData },
        $set: { updatedAt: new Date() },
      }
    );

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

app.post("/update/member", upload.single("profilePic"), async (req, res) => {
  const formData = req.body;
  const imageFile = req.file;
  const memberIdToUpdate = formData.importance;
  const allid = "634eefb4b35a8abf6acbdd2a"; // "All" team ID

  console.log("📝 Form Data:", formData);

  // Normalize teamIds
  let teamIds = formData.teamIds;
  if (typeof teamIds === "string") {
    try {
      teamIds = JSON.parse(teamIds);
    } catch {
      teamIds = [teamIds];
    }
  }
  if (!Array.isArray(teamIds)) {
    teamIds = [];
  }

  try {
    const client = await connectToMongoDB();
    const db = client.db(dbName);
    const collection = db.collection(collectionName);

    // ✅ Only member ID and name are required
    if (!memberIdToUpdate || !formData.name) {
      return res.status(400).json({
        success: false,
        message: "Member ID and name are required",
      });
    }

    const doc = await collection.findOne({
      "teams.members.memberID._id": memberIdToUpdate,
    });

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Member not found in any team",
      });
    }

    const allTeams = doc.teams;

    // 📸 Handle profile picture logic
    let profilePictureUrl = "";

    if (imageFile) {
      profilePictureUrl = `${API_ENDPOINT}/${imageFile.filename}`;
      console.log("🖼️ Using uploaded file:", profilePictureUrl);
    } else if (formData.profilePictureUrl) {
      const imageUrl = formData.profilePictureUrl.trim();

      if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) {
        profilePictureUrl = imageUrl;
        console.log("🌐 Using external URL:", profilePictureUrl);
      } else if (
        imageUrl.startsWith("/uploads/") ||
        imageUrl.includes("uploads/")
      ) {
        const filename = imageUrl.split("/").pop();
        profilePictureUrl = `${API_ENDPOINT}/${filename}`;
        console.log("📁 Using existing upload:", profilePictureUrl);
      } else if (imageUrl.startsWith("data:image/")) {
        profilePictureUrl = imageUrl;
        console.log("📊 Using base64 data URL");
      } else {
        profilePictureUrl = imageUrl;
        console.log("⚠️ Using URL as provided:", profilePictureUrl);
      }
    } else {
      // Retain existing profile picture if available
      for (let team of allTeams) {
        const existingMember = team.members.find(
          (m) => m.memberID._id === memberIdToUpdate
        );
        if (existingMember?.memberID?.profilePicture) {
          profilePictureUrl = existingMember.memberID.profilePicture;
          console.log(
            "🔄 Keeping existing profile picture:",
            profilePictureUrl
          );
          break;
        }
      }
    }

    // Parse `team` JSON string if present
    let parsedTeam = [];
    try {
      if (formData.team) {
        parsedTeam = JSON.parse(formData.team);
      }
    } catch (err) {
      console.warn("⚠️ Invalid team format");
    }

    // ✅ Construct updated member
    const updatedMember = {
      _id: memberIdToUpdate,
      name: formData.name,
      email: formData.email || "",
      isActive: true,
      created_by: "",
      profilePicture: profilePictureUrl,
      bio: formData.about || "",
      designation: formData.designation || "",
      designationText: formData.designationText || formData.designation || "",
      team: parsedTeam,
      doj: formData.doj || "",
      dob: formData.dob || "",
      yoe: formData.yoe || "",
      createdAt: new Date(),
      updatedAt: new Date(),
      __v: 0,
    };

    // 🔁 Update all teams
    for (let team of allTeams) {
      const teamId = team._id;
      const isSelected = teamIds.includes(teamId);
      const isAllTeam = teamId === allid;

      const memberIndex = team.members.findIndex(
        (m) => m.memberID._id === memberIdToUpdate
      );

      if (isSelected || isAllTeam) {
        if (memberIndex !== -1) {
          team.members[memberIndex].memberID = updatedMember;
        } else {
          team.members.push({ memberID: updatedMember });
        }
      } else if (!isAllTeam && memberIndex !== -1) {
        team.members.splice(memberIndex, 1);
      }
    }

    const updateResult = await collection.updateOne(
      { _id: doc._id },
      {
        $set: {
          teams: allTeams,
          updatedAt: new Date(),
        },
      }
    );

    if (updateResult.modifiedCount === 0) {
      return res.status(400).json({
        success: false,
        message: "No changes were made",
      });
    }

    res.status(200).json({
      success: true,
      message: "Member updated successfully",
      data: updatedMember,
    });
  } catch (err) {
    console.error("❌ Error updating member:", err.message);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message,
    });
  }
});

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is healthy",
    timestamp: new Date().toISOString(),
  });
});

app.post("/position/change", async (req, res) => {
  try {
    const { team: slug, members } = req.body;

    console.log(req.body, "this is client data");

    if (!slug || !Array.isArray(members)) {
      return res.status(400).json({
        success: false,
        message: "Missing 'team' or 'members' array",
      });
    }

    const formattedData = members.map((item, index) => ({
      memberID: {
        _id: item.key ?? `auto-${index}`,
        name: item.name ?? "N/A",
        email: item.email ?? "N/A",
        isActive: item.isActive ?? true,
        created_by: item.created_by ?? "unknown",
        profilePicture: item.profilePicture ?? "",
        bio: item.bio ?? item?.memberData?.bio ?? "N/A",
        designation: item.designation ?? "N/A",
        designationText: item.designation ?? "N/A",
        team: item.team
          ? item.team.split(",").map((teamName, idx) => ({
              name: teamName.trim(),
              _id: teamName.trim() || `team-${idx}`,
            }))
          : [{ name: "N/A", _id: "N/A" }],
        yoe: item.yoe ?? 0,
        doj: item.doj ?? "N/A",
        dob: item.dob ?? "N/A",
        position: item.position ?? index + 1,
        createdAt: item.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        __v: 0,
      },
      _id: item._id ?? item.key ?? `fallback-${index}`,
    }));

    const client = await connectToMongoDB();
    const db = client.db(dbName);
    const collection = db.collection(collectionName);

    // Update the team's members array where slug matches
    const result = await collection.updateOne(
      { "teams._id": slug }, // Find document with team that has matching slug
      {
        $set: {
          "teams.$.members": formattedData, // Replace the members array for matched team
        },
      }
    );

    console.log(formattedData);

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: `Team with slug '${slug}' not found`,
      });
    }

    if (result.modifiedCount === 0) {
      return res.status(400).json({
        success: false,
        message: "No changes were made to the team members",
      });
    }

    res.status(200).json({
      success: true,
      message: "Members replaced successfully",
      data: {
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        membersCount: formattedData.length,
      },
    });
  } catch (err) {
    console.error("Update failed:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

app.post("/get/team", async (req, res) => {
  const teamId = req.body.id;

  const client = await connectToMongoDB();
  const db = client.db(dbName);
  const collection = db.collection(collectionName);

  try {
    const result = await collection
      .aggregate([
        { $unwind: "$teams" },
        { $match: { "teams._id": teamId } },
        { $project: { members: "$teams.members", _id: 0 } },
      ])
      .toArray();

    if (result.length > 0) {
      res.status(200).json({ members: result[0].members });
    } else {
      res.status(404).json({ message: "Team not found" });
    }
  } catch (error) {
    console.error("Error retrieving team members:", error);
    res.status(500).json({ message: "Internal server error" });
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

app.get(/^\/(?!api).*/, (req, res) => {
  console.log("SPA fallback triggered for", req.url);
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

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
