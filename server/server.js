// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const twilio = require('twilio');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/pollytrack', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Twilio Setup (for SMS)
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Models
const FamilySchema = new mongoose.Schema({
  name: { type: String, required: true },
  members: [{
    name: { type: String, required: true },
    phone: { type: String, required: true },
    notifications: { type: Boolean, default: true }
  }],
  tasks: [{
    name: { type: String, required: true },
    category: { type: String, enum: ['health', 'hygiene', 'activity', 'other'], default: 'other' },
    completedBy: { type: String },
    completedAt: { type: Date },
    isCompleted: { type: Boolean, default: false }
  }],
  createdAt: { type: Date, default: Date.now }
});

const Family = mongoose.model('Family', FamilySchema);

// Controllers
class FamilyController {
  // Create family
  static async createFamily(req, res) {
    try {
      const { name, members } = req.body;
      const defaultTasks = [
        { name: 'Poop', category: 'hygiene' },
        { name: 'Pee', category: 'hygiene' },
        { name: 'Walk', category: 'activity' },
        { name: 'Feed', category: 'health' },
        { name: 'Medicine', category: 'health' },
        { name: 'Bath', category: 'hygiene' }
      ];
      
      const family = new Family({
        name,
        members,
        tasks: defaultTasks
      });
      
      await family.save();
      res.status(201).json(family);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  // Get family by ID
  static async getFamily(req, res) {
    try {
      const family = await Family.findById(req.params.id);
      if (!family) {
        return res.status(404).json({ error: 'Family not found' });
      }
      res.json(family);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  // Update family
  static async updateFamily(req, res) {
    try {
      const family = await Family.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true }
      );
      if (!family) {
        return res.status(404).json({ error: 'Family not found' });
      }
      res.json(family);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  // Complete task
  static async completeTask(req, res) {
    try {
      const { familyId, taskId } = req.params;
      const { completedBy } = req.body;
      
      const family = await Family.findById(familyId);
      if (!family) {
        return res.status(404).json({ error: 'Family not found' });
      }

      const task = family.tasks.id(taskId);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }

      task.completedBy = completedBy;
      task.completedAt = new Date();
      task.isCompleted = true;

      await family.save();

      // Send SMS notifications
      await FamilyController.sendTaskNotifications(family, task, completedBy);

      res.json(family);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  // Reset task
  static async resetTask(req, res) {
    try {
      const { familyId, taskId } = req.params;
      
      const family = await Family.findById(familyId);
      if (!family) {
        return res.status(404).json({ error: 'Family not found' });
      }

      const task = family.tasks.id(taskId);
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }

      task.completedBy = '';
      task.completedAt = null;
      task.isCompleted = false;

      await family.save();
      res.json(family);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  // Add new task
  static async addTask(req, res) {
    try {
      const { familyId } = req.params;
      const { name, category } = req.body;
      
      const family = await Family.findById(familyId);
      if (!family) {
        return res.status(404).json({ error: 'Family not found' });
      }

      family.tasks.push({ name, category });
      await family.save();
      res.json(family);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  // Toggle member notifications
  static async toggleNotifications(req, res) {
    try {
      const { familyId, memberId } = req.params;
      
      const family = await Family.findById(familyId);
      if (!family) {
        return res.status(404).json({ error: 'Family not found' });
      }

      const member = family.members.id(memberId);
      if (!member) {
        return res.status(404).json({ error: 'Member not found' });
      }

      member.notifications = !member.notifications;
      await family.save();
      res.json(family);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  // Send SMS notifications
  static async sendTaskNotifications(family, task, completedBy) {
    const message = `${completedBy} completed task: ${task.name} for ${family.name}`;
    
    for (const member of family.members) {
      if (member.notifications && member.name !== completedBy) {
        try {
          await twilioClient.messages.create({
            body: message,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: member.phone
          });
        } catch (error) {
          console.error(`Failed to send SMS to ${member.phone}:`, error.message);
        }
      }
    }
  }
}

// Routes
app.post('/api/families', FamilyController.createFamily);
app.get('/api/families/:id', FamilyController.getFamily);
app.put('/api/families/:id', FamilyController.updateFamily);
app.post('/api/families/:familyId/tasks/:taskId/complete', FamilyController.completeTask);
app.post('/api/families/:familyId/tasks/:taskId/reset', FamilyController.resetTask);
app.post('/api/families/:familyId/tasks', FamilyController.addTask);
app.post('/api/families/:familyId/members/:memberId/toggle-notifications', FamilyController.toggleNotifications);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`PollyTrack server running on port ${PORT}`);
});