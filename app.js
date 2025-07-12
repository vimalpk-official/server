import express from "express";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import cors from "cors";
import multer from "multer";
import { ObjectId } from "mongodb";

dotenv.config();

const app = express();
const PORT = 7000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

const uri = process.env.MONGO_URI;
const dbName = process.env.DB_NAME;
const collectionName = process.env.COLLECTION_NAME;

async function connectToMongoDB() {
  const client = new MongoClient(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  await client.connect();
  return client;
}

app.get("/api/calldata", async (req, res) => {
  console.log("Client triggered the API call data");
  let client;
  try {
    client = await connectToMongoDB();
    console.log("Connected to MongoDB");
    const db = client.db(dbName);
    const collection = db.collection(collectionName);
    const allDocs = await collection.find({}).toArray();
    console.log("Data retrieved from MongoDB:");
    console.log(allDocs);
    res.status(200).json({
      success: true,
      teams: [
        {
          members: allDocs,
        },
      ],
    });
  } catch (error) {
    console.error("Error retrieving data:", error);
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
  console.log("Save data endpoint triggered");
  let client;
  try {
    const formData = req.body;
    const imageFile = req.file;
    console.log("Form Data:", formData);
    console.log("Uploaded File:", imageFile ? "File received" : "No file");
    const imageBase64 = imageFile ? imageFile.buffer.toString("base64") : null;
    const memberData = {
      memberID: {
        _id: new ObjectId(),
        name: formData.name,
        email: formData.email,
        ...(imageBase64 && {
          profilePicture: {
            data: imageBase64,
            contentType: imageFile.mimetype,
            filename: imageFile.originalname,
            size: imageFile.size,
          },
        }),
        bio: formData.content,
        designation: formData.designation,
        team: [
          {
            name: formData.teamName,
          },
        ],
        designationText: formData.designation,
        createdAt: new Date(),
        updatedAt: new Date(),
        __v: 0,
      },
    };
    const teamId = formData.teamId;
    console.log(teamId, "1233344");
    const allTeamId = "634eefb4b35a8abf6acbdd2a";
    console.log(allTeamId, "all");
    client = await connectToMongoDB();
    console.log("Connected to MongoDB for saving");
    const db = client.db(dbName);
    const collection = db.collection(collectionName);
    const result1 = await collection.updateOne(
      { "teams._id": teamId },
      {
        $push: { "teams.$.members": memberData },
        $set: { updatedAt: new Date() },
      }
    );
    const result2 = await collection.updateOne(
      { "teams._id": allTeamId },
      {
        $push: { "teams.$.members": memberData },
        $set: { updatedAt: new Date() },
      }
    );
    console.log("Data saved to MongoDB");
    console.log("Result1 (specific team):", result1.modifiedCount);
    console.log("Result2 (all team):", result2.modifiedCount);
    res.status(200).json({
      success: true,
      message: "Member data saved to both team documents",
      results: {
        specificTeam: result1.modifiedCount > 0 ? "Success" : "Team not found",
        allTeam: result2.modifiedCount > 0 ? "Success" : "All team not found",
      },
    });
  } catch (error) {
    console.error("Error saving data:", error);
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


app.delete("/delete/member", async (req, res) => {
  let client;

  try {
    const memberIdToDelete = req.body.key;
    if (!memberIdToDelete) {
      return res.status(400).json({ message: "Member ID is required." });
    }

    const objectMemberId = new ObjectId(memberIdToDelete);

    client = await connectToMongoDB();
    const db = client.db(dbName);
    const collection = db.collection(collectionName);

    const result = await collection.updateOne(
      { "teams.members.memberID._id": objectMemberId }, // match any document containing that member
      {
        $pull: {
          "teams.$[].members": { "memberID._id": objectMemberId }
        },
        $set: {
          updatedAt: new Date()
        }
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(404).json({ message: "Member not found or already removed." });
    }

    console.log("✅ Member removed from all teams in the document.");
    res.status(200).json({ message: "Member successfully removed from all teams." });

  } catch (err) {
    console.error("❌ Error deleting member:", err);
    res.status(500).json({ message: "Internal server error." });
  } finally {
    if (client) {
      await client.close();
      console.log("🔒 MongoDB connection closed.");
    }
  }
});






app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});