const express = require("express");
const fileUpload = require("express-fileupload");
const faceapi = require("face-api.js");
const canvas = require("canvas");
const admin = require("firebase-admin");
const serviceAccount = require("./firebase/serviceKey.json");

const { Canvas, Image, ImageData } = canvas;

faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

// Firebase setup
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

const app = express();

app.use(
  fileUpload({
    useTempFiles: true,
    tempFileDir: "/tmp/",
  })
);

async function LoadModels() {
  console.log("Loading face-api.js models...");
  await faceapi.nets.faceRecognitionNet.loadFromDisk(__dirname + "/models");
  await faceapi.nets.faceLandmark68Net.loadFromDisk(__dirname + "/models");
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(__dirname + "/models");
  console.log("Face-api.js models loaded successfully.");
}
LoadModels();

async function uploadLabeledImages(images, label, userId) {
  try {
    console.log(`Start processing upload for userId: ${userId}, label: ${label}`);
    const descriptions = [];
    for (let i = 0; i < images.length; i++) {
      console.log(`Loading image ${i + 1}/${images.length}...`);
      const img = await canvas.loadImage(images[i]);
      console.log(`Detecting face in image ${i + 1}...`);
      const detections = await faceapi
        .detectSingleFace(img)
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (!detections) {
        console.warn(`No face detected in image ${i + 1}`);
        continue;
      }
      descriptions.push({ descriptor: Array.from(detections.descriptor) });
    }

    console.log(`Saving face data to Firestore for userId: ${userId}`);
    await db.collection('faces').doc(userId).set({
      userId: userId,
      label: label,
      descriptions: descriptions.slice(-10),
    });

    console.log(`Face data saved successfully for userId: ${userId}`);
    return true;
  } catch (error) {
    console.error(`Error in uploadLabeledImages:`, error);
    return error;
  }
}

app.post("/post-face", async (req, res) => {
  try {
    console.log("Received /post-face request.");
    if (!req.files || !req.files.File1 || !req.files.File2 || !req.files.File3) {
      return res.status(400).json({ message: "Files are missing." });
    }
    if (!req.body.label || !req.body.userId) {
      return res.status(400).json({ message: "Label or userId is missing." });
    }

    const File1 = req.files.File1.tempFilePath;
    const File2 = req.files.File2.tempFilePath;
    const File3 = req.files.File3.tempFilePath;
    const label = req.body.label;
    const userId = req.body.userId;

    let result = await uploadLabeledImages([File1, File2, File3], label, userId);
    if (result === true) {
      res.json({ message: "Face data stored successfully" });
    } else {
      res.status(500).json({ message: "Error saving face data.", error: result });
    }
  } catch (error) {
    console.error("Error in /post-face:", error);
    res.status(500).json({ message: "Internal server error.", error });
  }
});

app.post("/check-face", async (req, res) => {
  try {
    console.log("Received /check-face request.");
    if (!req.files || !req.files.File1) {
      return res.status(400).json({ message: "File is missing." });
    }
    if (!req.body.userId) {
      return res.status(400).json({ message: "userId is missing." });
    }

    const File1 = req.files.File1.tempFilePath;
    const userId = req.body.userId;

    console.log(`Fetching face data for userId: ${userId}`);
    const doc = await db.collection('faces').doc(userId).get();
    if (!doc.exists) {
      return res.status(404).json({ message: "User face data not found." });
    }

    const data = doc.data();
    let descriptions = data.descriptions.map(
      (item) => new Float32Array(item.descriptor)
    );
    const labeledDescriptor = new faceapi.LabeledFaceDescriptors(data.label, descriptions);

    const faceMatcher = new faceapi.FaceMatcher([labeledDescriptor], 0.6);

    console.log(`Loading and processing uploaded image...`);
    const img = await canvas.loadImage(File1);
    const detections = await faceapi
      .detectSingleFace(img)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detections) {
      return res.status(404).json({ message: "No face detected in the image." });
    }

    const matchResult = faceMatcher.findBestMatch(detections.descriptor);

    console.log(`Matching result:`, matchResult);

    // ✅ Update descriptor jika distance <= 0.4
    if (matchResult.distance <= 0.4) {
      console.log(`Distance ${matchResult.distance} <= 0.4, updating descriptors...`);

      // Tambah descriptor baru ke array
      data.descriptions.push({
        descriptor: Array.from(detections.descriptor),
      });

      // Batasi maksimal 10 descriptor
      data.descriptions = data.descriptions.slice(-10);

      // Update Firestore
      await db.collection('faces').doc(userId).update({
        descriptions: data.descriptions,
      });

      console.log(`Face data updated for userId: ${userId} (total descriptors: ${data.descriptions.length})`);
    }

    res.json({ result: matchResult });
  } catch (error) {
    console.error("Error in /check-face:", error);
    res.status(500).json({ message: "Error checking face.", error: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
