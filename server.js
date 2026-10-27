
const express = require("express");
const mysql = require("mysql2/promise");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const path = require("path");

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
    session({
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            maxAge: 60 * 60 * 1000
        }
    })
);

app.use(express.static(path.join(__dirname, "public")));

const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
});

function requireLogin(req, res, next) {
    if (!req.session.user) {
        return res.status(401).json({ message: "Please log in first." });
    }
    next();
}

// Test the database connection
app.get("/api/test", async (req, res) => {
    try {
        await db.query("SELECT 1");
        res.json({ message: "MySQL connected successfully!" });
    } catch (error) {
        res.status(500).json({ message: "Database connection failed." });
    }
});

// Register a donor or NGO

app.post("/api/register", async (req, res) => {
    console.log("REGISTER ROUTE REACHED");

    try {
        const { name, email, password, role } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                message: "Please fill in all required fields."
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                message: "Password must contain at least 6 characters."
            });
        }

        const userRole = role === "ngo" ? "ngo" : "donor";
        const hashedPassword = await bcrypt.hash(password, 10);

        await db.execute(
            "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)",
            [name, email, hashedPassword, userRole]
        );

        return res.status(201).json({
            message: "Registration successful. Please log in."
        });

    } catch (error) {
        console.error("REGISTRATION ERROR:", error);

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                message: "This email is already registered."
            });
        }

        return res.status(500).json({
            message: "Registration failed.",
            error: error.message
        });
    }
});


// Login
app.post("/api/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        const [users] = await db.execute(
            "SELECT user_id, name, email, password, role FROM users WHERE email = ?",
            [email]
        );

        if (
            users.length === 0 ||
            !(await bcrypt.compare(password, users[0].password))
        ) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
        }

        req.session.user = {
            user_id: users[0].user_id,
            name: users[0].name,
            email: users[0].email,
            role: users[0].role
        };

        res.json({
            message: "Login successful.",
            user: req.session.user
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Login failed." });
    }
});

// Get logged-in user
app.get("/api/me", (req, res) => {
    res.json({ user: req.session.user || null });
});

// Logout
app.post("/api/logout", (req, res) => {
    req.session.destroy(() => {
        res.json({ message: "Logged out successfully." });
    });
});

// View all campaigns
app.get("/api/campaigns", async (req, res) => {
    try {
        const [campaigns] = await db.execute(
            `SELECT campaign_id, user_id, title, description,
                    goal_amount, current_amount, status, created_at
             FROM campaigns
             ORDER BY created_at DESC`
        );

        res.json(campaigns);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Could not load campaigns." });
    }
});

// Create a campaign (NGO account required)
app.post("/api/campaigns", requireLogin, async (req, res) => {
    try {
        if (req.session.user.role !== "ngo") {
            return res.status(403).json({
                message: "Only NGO accounts can create campaigns."
            });
        }

        const { title, description, goal_amount } = req.body;
        const goal = Number(goal_amount);

        if (
            !title ||
            !description ||
            !Number.isFinite(goal) ||
            goal <= 0
        ) {
            return res.status(400).json({
                message: "Enter a title, description and valid goal amount."
            });
        }

        const [result] = await db.execute(
            `INSERT INTO campaigns
             (user_id, title, description, goal_amount, current_amount, status)
             VALUES (?, ?, ?, ?, 0, 'active')`,
            [req.session.user.user_id, title, description, goal]
        );

        res.status(201).json({
            message: "Campaign created successfully.",
            campaign_id: result.insertId
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Could not create campaign." });
    }
});

// Make a simulated donation
app.post("/api/donate", requireLogin, async (req, res) => {
    const amount = Number(req.body.amount);
    const campaignId = Number(req.body.campaign_id);

    if (
        !Number.isSafeInteger(campaignId) ||
        campaignId <= 0 ||
        !Number.isFinite(amount) ||
        amount <= 0
    ) {
        return res.status(400).json({
            message: "Enter a valid campaign and donation amount."
        });
    }

    let connection;

    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        const [campaigns] = await connection.execute(
            "SELECT campaign_id FROM campaigns WHERE campaign_id = ? AND status = 'active' FOR UPDATE",
            [campaignId]
        );

        if (campaigns.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                message: "Active campaign not found."
            });
        }

        await connection.execute(
            "INSERT INTO donations (campaign_id, user_id, amount) VALUES (?, ?, ?)",
            [campaignId, req.session.user.user_id, amount]
        );

        await connection.execute(
            "UPDATE campaigns SET current_amount = current_amount + ? WHERE campaign_id = ?",
            [amount, campaignId]
        );

        await connection.commit();

        res.json({
            message: "Simulated donation successful. No real money was charged."
        });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error(error);
        res.status(500).json({ message: "Donation failed." });
    } finally {
        if (connection) connection.release();
    }
});

// View your donation history
app.get("/api/donations", requireLogin, async (req, res) => {
    try {
        const [donations] = await db.execute(
            `SELECT d.donation_id, d.campaign_id, c.title,
                    d.amount, d.donated_at
             FROM donations d
             JOIN campaigns c ON d.campaign_id = c.campaign_id
             WHERE d.user_id = ?
             ORDER BY d.donated_at DESC`,
            [req.session.user.user_id]
        );

        res.json(donations);
    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Could not load donation history."
        });
    }
});

// Start server
async function startServer() {
    try {
        await db.query("SELECT 1");
        console.log("MySQL connected successfully!");

        app.listen(PORT, () => {
            console.log(`Server running at http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("Could not connect to MySQL:", error.message);
    }
}

startServer();
