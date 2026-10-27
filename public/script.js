
const message = document.getElementById("message");
let currentUser = null;

function showMessage(text) {
    message.textContent = text;
}

async function api(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...options.headers
        }
    });

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.message || "Something went wrong.");
    }

    return data;
}

async function loadUser() {
    try {
        const data = await api("/api/me");
        currentUser = data.user;
        updateAccount();
    } catch (error) {
        showMessage(error.message);
    }
}

function updateAccount() {
    const userInfo = document.getElementById("userInfo");
    const logoutBtn = document.getElementById("logoutBtn");
    const createCampaign = document.getElementById("createCampaign");
    const history = document.getElementById("history");

    if (currentUser) {
        userInfo.textContent =
            `Logged in as ${currentUser.name} (${currentUser.role})`;
        logoutBtn.hidden = false;
        createCampaign.hidden = currentUser.role !== "ngo";
        history.hidden = currentUser.role !== "donor";
        document.getElementById("registerForm").hidden = true;
        document.getElementById("loginForm").hidden = true;

        if (currentUser.role === "donor") {
            loadHistory();
        }
    } else {
        userInfo.textContent = "Please register or log in.";
        logoutBtn.hidden = true;
        createCampaign.hidden = true;
        history.hidden = true;
        document.getElementById("registerForm").hidden = false;
        document.getElementById("loginForm").hidden = false;
    }
}

document.getElementById("registerForm").addEventListener("submit", async event => {
    event.preventDefault();

    try {
        const data = await api("/api/register", {
            method: "POST",
            body: JSON.stringify({
                name: document.getElementById("regName").value,
                email: document.getElementById("regEmail").value,
                password: document.getElementById("regPassword").value,
                role: document.getElementById("regRole").value
            })
        });

        showMessage(data.message + " You can now log in.");
        event.target.reset();
    } catch (error) {
        showMessage(error.message);
    }
});

document.getElementById("loginForm").addEventListener("submit", async event => {
    event.preventDefault();

    try {
        const data = await api("/api/login", {
            method: "POST",
            body: JSON.stringify({
                email: document.getElementById("loginEmail").value,
                password: document.getElementById("loginPassword").value
            })
        });

        currentUser = data.user;
        updateAccount();
        await loadCampaigns();
        showMessage(data.message);
        event.target.reset();
    } catch (error) {
        showMessage(error.message);
    }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
    try {
        const data = await api("/api/logout", { method: "POST" });
        currentUser = null;
        updateAccount();
        await loadCampaigns();
        showMessage(data.message);
    } catch (error) {
        showMessage(error.message);
    }
});

document.getElementById("campaignForm").addEventListener("submit", async event => {
    event.preventDefault();

    try {
        const data = await api("/api/campaigns", {
            method: "POST",
            body: JSON.stringify({
                title: document.getElementById("campaignTitle").value,
                description: document.getElementById("campaignDescription").value,
                goal_amount: document.getElementById("campaignGoal").value
            })
        });

        showMessage(data.message);
        event.target.reset();
        await loadCampaigns();
    } catch (error) {
        showMessage(error.message);
    }
});

async function loadCampaigns() {
    const container = document.getElementById("campaignList");
    container.textContent = "Loading campaigns...";

    try {
        const campaigns = await api("/api/campaigns");
        container.replaceChildren();

        if (campaigns.length === 0) {
            container.textContent = "No campaigns yet. Check back soon!";
            return;
        }

        campaigns.forEach(campaign => {
            const card = document.createElement("article");
            card.className = "campaign-card";

            const title = document.createElement("h3");
            title.textContent = campaign.title;

            const description = document.createElement("p");
            description.textContent = campaign.description || "";

            const status = document.createElement("p");
            status.textContent = "Status: " + campaign.status;

            const raised = Number(campaign.current_amount || 0);
            const goal = Number(campaign.goal_amount || 0);
            const progress = goal > 0
                ? Math.min(100, raised / goal * 100)
                : 0;

            const amount = document.createElement("p");
            amount.textContent =
                `₹${raised.toFixed(2)} raised of ₹${goal.toFixed(2)}`;

            const bar = document.createElement("div");
            bar.className = "progress";

            const fill = document.createElement("div");
            fill.style.width = progress + "%";
            bar.appendChild(fill);

            card.append(title, description, status, amount, bar);

            if (campaign.status === "active" &&
                currentUser?.role === "donor") {
                const donateBtn = document.createElement("button");
                donateBtn.textContent = "Donate";
                donateBtn.addEventListener("click", () => donate(campaign.campaign_id));
                card.appendChild(donateBtn);
            }

            container.appendChild(card);
        });
    } catch (error) {
        container.textContent = error.message;
    }
}

async function donate(campaignId) {
    const amount = prompt("Enter donation amount in ₹ (simulated only):");

    if (amount === null) return;

    const value = Number(amount);

    if (!Number.isFinite(value) || value <= 0) {
        showMessage("Enter a valid positive amount.");
        return;
    }

    try {
        const data = await api("/api/donate", {
            method: "POST",
            body: JSON.stringify({
                campaign_id: campaignId,
                amount: value
            })
        });

        showMessage(data.message);
        await loadCampaigns();
        await loadHistory();
    } catch (error) {
        showMessage(error.message);
    }
}

async function loadHistory() {
    if (!currentUser || currentUser.role !== "donor") return;

    const container = document.getElementById("donationHistory");

    try {
        const donations = await api("/api/donations");
        container.replaceChildren();

        if (donations.length === 0) {
            container.textContent = "You haven't made any donations yet.";
            return;
        }

        donations.forEach(donation => {
            const item = document.createElement("p");
            item.textContent =
                `${donation.title} — ₹${Number(donation.amount).toFixed(2)}`;
            container.appendChild(item);
        });
    } catch (error) {
        container.textContent = error.message;
    }
}

async function startApp() {
    await loadUser();
    await loadCampaigns();
}

startApp();
