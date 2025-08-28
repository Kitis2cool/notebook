/* ===== Firebase ===== */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot,
  deleteDoc, doc, query, orderBy, setDoc,
  updateDoc, arrayUnion, arrayRemove, serverTimestamp, getDoc, getDocs
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

/* ===== Firebase (Spark-plan friendly: no Storage) ===== */
const firebaseConfig = {
  apiKey: "AIzaSyBXhiyGWev_pgR04Xqwq-09cE_oyrLWnU8",
  authDomain: "kitisnotebook.firebaseapp.com",
  projectId: "kitisnotebook",
  // storageBucket intentionally omitted for free plan
  messagingSenderId: "450680847245",
  appId: "1:450680847245:web:2e4ebb71ccd3a7920bdbc4",
  measurementId: "G-W3ZVV6N6KK"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/* ===== Admin & login ===== */
const ADMIN_USER = "kitis";
let isAdmin = true;
const loggedInUser = localStorage.getItem("loggedInUser");
if (!loggedInUser) window.location.href = "login.html";
(document.getElementById("username")).value = loggedInUser;
if (loggedInUser === ADMIN_USER) isAdmin = true;
// Ensure my user doc exists so friends can reference me
await setDoc(doc(db, "users", loggedInUser), { createdAt: Date.now() }, { merge: true });

/* ===== Helpers ===== */
const looksLikeUrl = (text = "") => /^https?:\/\/\S+$/i.test(text.trim());
const isImageUrl = (str = "") => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(str.split(/[?#]/)[0]);
const isGroupKey = (k) => typeof k === "string" && k.startsWith("group:");
const groupNameFromKey = (k) => (k.split(":")[1] || "").trim();
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function formatLastSeen(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
/* Unread tracking */
let unreadCounts = {};
let unreadMessageIds = {}; // { key: Set<messageId> }
/* ===== Profanity filter ===== */
const bannedWords = [
  "fuck","bitch","pussy","cock","cum","slut","whore",
  "france","french","british","asshole","dick","cunt","bastard","motherfucker",
  "nigger","nigga","chink","spic","fag","faggot","retard"
];
function filterProfanity(text) {
  let filtered = text;
  bannedWords.forEach((w) => {
    const regex = new RegExp(w, "gi");
    filtered = filtered.replace(regex, "****");
  });
  return filtered;
}

/* ===== Presence ===== */
const friendsList = document.getElementById("friendsList");
const requestsList = document.getElementById("requestsList");
const discoverList = document.getElementById("discoverList");

// Track who is online + their meta
let presence = {}; // { username: { lastActive:number, avatar:string } }

// Friends state
let friendsAccepted = new Set();
let friendsPendingOut = new Set(); // I sent
let friendsRequestedIn = new Set(); // They sent

// Listen to online presence
onSnapshot(collection(db, "onlineUsers"), (snapshot) => {
  const now = Date.now();
  const map = {};
  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const user = data.username;
    if (!user || user === loggedInUser) return; // hide self
    map[user] = {
      lastActive: data.lastActive || 0,
      avatar: data.avatar || `https://i.pravatar.cc/30?u=${user}`,
      online: now - (data.lastActive || 0) <= 60 * 1000
    };
  });
  presence = map;
  renderFriends();
  renderDiscover();
});

/* ===== Friends subcollection ===== */
const myFriendsCol = collection(db, "users", loggedInUser, "friends");

onSnapshot(myFriendsCol, (snap) => {
  friendsAccepted = new Set();
  friendsPendingOut = new Set();
  friendsRequestedIn = new Set();

  snap.forEach((docSnap) => {
    const friend = docSnap.id;
    const data = docSnap.data();
    const status = (data && data.status) || "";
    if (status === "accepted") friendsAccepted.add(friend);
    else if (status === "pending") friendsPendingOut.add(friend);
    else if (status === "requested") friendsRequestedIn.add(friend);
  });

  renderFriends();
  renderRequests();
  renderDiscover();
});



async function respondToFriendRequest(fromUser, accept) {
  const myRef = doc(db, "users", loggedInUser, "friends", fromUser);
  const theirRef = doc(db, "users", fromUser, "friends", loggedInUser);
  try {
    if (accept) {
      await updateDoc(myRef, { status: "accepted" });
      await updateDoc(theirRef, { status: "accepted" });
    } else {
      await deleteDoc(myRef);
      await deleteDoc(theirRef);
    }
  } catch (e) {
    console.error(e);
    alert("Failed to update request.");
  }
}

async function cancelFriendRequest(user) {
  const myRef = doc(db, "users", loggedInUser, "friends", user);
  const theirRef = doc(db, "users", user, "friends", loggedInUser);
  try {
    await deleteDoc(myRef);
    await deleteDoc(theirRef);
  } catch (e) {
    console.error(e);
    alert("Failed to cancel request.");
  }
}

async function removeFriend(user) {
  if (!confirm(`Remove ${user} from friends?`)) return;
  const myRef = doc(db, "users", loggedInUser, "friends", user);
  const theirRef = doc(db, "users", user, "friends", loggedInUser);
  try {
    await deleteDoc(myRef);
    await deleteDoc(theirRef);
  } catch (e) {
    console.error(e);
    alert("Failed to remove friend.");
  }
}



/* ===== Rendering ===== */
function sortUsersByPresence(usernames) {
  const now = Date.now();
  return [...usernames].sort((a, b) => {
    const A = presence[a] || {}; const B = presence[b] || {};
    const aOnline = A.lastActive ? now - A.lastActive <= 60*1000 : false;
    const bOnline = B.lastActive ? now - B.lastActive <= 60*1000 : false;
    if (aOnline && !bOnline) return -1;
    if (!aOnline && bOnline) return 1;
    return (B.lastActive || 0) - (A.lastActive || 0);
  });
}


// --- helper function ---
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const myAvatarImg = document.getElementById("myAvatarImg");
  const profilePicInput = document.getElementById("profilePicInput");

  // Load current user's avatar from localStorage
  if (myAvatarImg) {
    const savedAvatar = localStorage.getItem(`avatar_${loggedInUser}`);
    if (savedAvatar) myAvatarImg.src = savedAvatar;
  }

  if (!profilePicInput) return;

  profilePicInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      alert("File too large! Max 2MB.");
      profilePicInput.value = "";
      return;
    }

    try {
      const dataURL = await fileToDataURL(file);
      await setDoc(doc(db, "profiles", loggedInUser), {
  avatar: dataURL
}, { merge: true });


      // Refresh friends list
      renderFriends();

      alert("Profile picture updated!");
    } catch (err) {
      console.error(err);
      alert("Failed to load image.");
    }
  });
});

function buildUserRow(user, opts = {}) {
  const savedAvatar = localStorage.getItem(`avatar_${user}`);
  const defaultAvatar = `https://i.pravatar.cc/30?u=${user}`;
  const meta = presence[user] || { lastActive: 0 };
  const loggedInUser = localStorage.getItem("loggedInUser");

  const div = document.createElement("div");
  div.className = "online-user";
  div.dataset.user = user;

  // Avatar
  const avatar = document.createElement("img");
  avatar.src = savedAvatar || defaultAvatar;
  avatar.className = "avatar";

  // Info
  const info = document.createElement("span");
  info.style.color = meta.online ? 'limegreen' : 'gray';
  const username = document.createElement("strong");
  username.textContent = user + " ";
  const status = document.createElement("span");
  status.textContent = meta.online ? "online" : "(last seen " + timeAgo(meta.lastActive) + ")";
  status.style.fontWeight = "normal";
  info.appendChild(username);
  info.appendChild(status);

  // Actions
  const right = document.createElement("div");
  right.className = "actions";

  // Add buttons from opts.buttons
  (opts.buttons || []).forEach((btnDef) => {
    // Only show Logout button for the logged-in user
    if (btnDef.text === "Logout" && user !== loggedInUser) return;

    const b = document.createElement("button");
    b.className = "action-btn";
    b.textContent = btnDef.text;
    b.style.cssText = `
      padding: 5px 12px;
      margin-left: 6px;
      border: none;
      border-radius: 12px;
      background: linear-gradient(90deg, #4c8bf5, #1d4ed8);
      color: white;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    `;
    b.addEventListener("mouseenter", () => {
      b.style.boxShadow = "0 4px 12px rgba(76,139,245,0.5)";
      b.style.transform = "translateY(-1px)";
    });
    b.addEventListener("mouseleave", () => {
      b.style.boxShadow = "none";
      b.style.transform = "translateY(0)";
    });

    b.onclick = async (e) => {
      e.stopPropagation();
      if (btnDef.text === "Logout") {
        try {
          await setDoc(doc(db, "onlineUsers", loggedInUser), { online: false }, { merge: true });
        } catch (err) {
          console.warn("Logout presence update failed:", err);
        } finally {
          localStorage.removeItem("loggedInUser");
          window.location.href = "login.html";
        }
      } else {
        btnDef.onClick && btnDef.onClick();
      }
    };

    right.appendChild(b);
  });

  div.appendChild(avatar);
  div.appendChild(info);
  div.appendChild(right);

  if (!opts.preventRowClick) {
    div.onclick = () => openTab(user);
  }

  return div;
}

const logoutBtn = document.getElementById("logoutBtn");

logoutBtn.onclick = async () => {
  try {
    // Mark the user offline in Firestore
    await setDoc(doc(db, "onlineUsers", loggedInUser), { online: false }, { merge: true });
  } catch (err) {
    console.warn("Failed to update online status:", err);
  } finally {
    // Remove local login info
    localStorage.removeItem("loggedInUser");
    // Redirect to login page
    window.location.href = "login.html";
  }
};



function renderFriends() {
  friendsList.innerHTML = "";

  // All Chat pseudo-row
  const allDiv = document.createElement("div");
  allDiv.className = "online-user";
  allDiv.dataset.user = "all";
  const leftAll = document.createElement("div");
  leftAll.style.display = "flex";
  leftAll.style.flexDirection = "column";
  const labelAll = document.createElement("span");
  labelAll.textContent = "All Chat";
  leftAll.appendChild(labelAll);
  allDiv.appendChild(leftAll);
  const rightAll = document.createElement("div");
  rightAll.style.display = "flex";
  rightAll.style.alignItems = "center";
  const unreadHolderAll = document.createElement("span");
  unreadHolderAll.className = "unread-holder";
  rightAll.appendChild(unreadHolderAll);
  allDiv.appendChild(rightAll);
  allDiv.onclick = () => openTab("all");
  friendsList.appendChild(allDiv);
  updateUnreadBadge("all");

  const sorted = sortUsersByPresence(friendsAccepted);
  sorted.forEach((user) => {
    const row = buildUserRow(user, {
      buttons: [
        { text: "Chat", title: "Open chat", onClick: () => openTab(user) },
        { text: "−", title: "Remove friend", onClick: () => removeFriend(user) },
      ],
    });
    friendsList.appendChild(row);
    updateUnreadBadge(user);
  });

  if (!sorted.length) {
    const hint = document.createElement("div");
    hint.style.fontSize = "12px";
    hint.style.color = "#ccc";
    hint.style.marginTop = "6px";
    hint.innerHTML = "No friends yet. Use <strong>Discover</strong> or add by username above.";
    friendsList.appendChild(hint);
  }
}

function renderRequests() {
  requestsList.innerHTML = "";

  // Incoming requests (requested -> me)
sortUsersByPresence(friendsRequestedIn).forEach((user) => {
  const row = buildUserRow(user, {
    buttons: [
      { text: "Accept", onClick: () => respondToFriendRequest(user, true) },
      { text: "Reject", onClick: () => respondToFriendRequest(user, false) },
    ],
    preventRowClick: true
  });
  requestsList.appendChild(row);
});

  // Outgoing pending (I sent)
  sortUsersByPresence(friendsPendingOut).forEach((user) => {
    const row = buildUserRow(user, {
      buttons: [
        { text: "Pending…", title: "Waiting for response", onClick: () => {} },
        { text: "Cancel", onClick: () => cancelFriendRequest(user) },
      ],
      preventRowClick: true
    });
    requestsList.appendChild(row);
  });

  // Show placeholder if no requests
  if (!friendsRequestedIn.size && !friendsPendingOut.size) {
    const none = document.createElement("div");
    none.style.fontSize = "12px";
    none.style.color = "#ccc";
    none.textContent = "No pending requests.";
    requestsList.appendChild(none);
  }
}


function renderDiscover() {
  const allOnline = new Set(Object.keys(presence));
  const notFriends = [...allOnline].filter(
    (u) => !friendsAccepted.has(u) && u !== loggedInUser
  );
  const sorted = sortUsersByPresence(notFriends);

  discoverList.innerHTML = "";
  sorted.forEach((user) => {
    const alreadyPending = friendsPendingOut.has(user);
    const alreadyIncoming = friendsRequestedIn.has(user);

    const row = buildUserRow(user, {
      buttons: [
        alreadyPending
          ? { text: "Pending…", onClick: () => {} }
          : alreadyIncoming
          ? { text: "Accept", onClick: () => respondToFriendRequest(user, true) }
          : { text: "Add", onClick: () => sendFriendRequest(user) },
      ],
      preventRowClick: true, // disable row click for discover list
    });

    discoverList.appendChild(row);
  });

  if (!sorted.length) {
    const msg = document.createElement("div");
    msg.style.fontSize = "12px";
    msg.style.color = "#ccc";
    msg.textContent = "No one to discover right now.";
    discoverList.appendChild(msg);
  }
}


async function sendFriendRequest(toUser) {
  if (!toUser || toUser === loggedInUser) return;
  const myRef = doc(db, "users", loggedInUser, "friends", toUser);
  const theirRef = doc(db, "users", toUser, "friends", loggedInUser);

  try {
    await setDoc(myRef, { status: "pending" });
    await setDoc(theirRef, { status: "requested" });
  } catch (err) {
    console.error(err);
    alert("Failed to send friend request.");
  }
}

/* Controls */
document.getElementById("addFriendBtn").onclick = () => {
  const input = document.getElementById("friendInput");
  sendFriendRequest(input.value);
  input.value = "";
};

const toggleDiscoverBtn = document.getElementById("toggleDiscoverBtn");
toggleDiscoverBtn.onclick = () => {
  const isHidden = getComputedStyle(discoverList).display === "none";
  discoverList.style.display = isHidden ? "block" : "none";
};

/* ===== Presence: mark myself online ===== */
async function goOnline() {
  const userRef = doc(db, "onlineUsers", loggedInUser);
  await setDoc(userRef, {
    username: loggedInUser,
    lastActive: Date.now(),
    avatar: "https://i.pravatar.cc/30?u=" + loggedInUser,
  });
}
goOnline();
setInterval(async () => {
  const userRef = doc(db, "onlineUsers", loggedInUser);
  await setDoc(
    userRef,
    { username: loggedInUser, lastActive: Date.now(), avatar: `https://i.pravatar.cc/30?u=${loggedInUser}` },
    { merge: true }
  );
}, 30000);

/* Optional profile live updates for current user avatar/status (guarded) */
onSnapshot(doc(db, "profiles", loggedInUser), (snap) => {
  if (!snap.exists()) return;
  const data = snap.data();
  const img = document.querySelector(`.online-user[data-user="${loggedInUser}"] img`);
  if (img && data.avatar) img.src = data.avatar;
});


/* ===== Groups: UI + Data ===== */
const sidebar = document.getElementById("sidebar");


const groupsHeader = document.createElement("h3");
groupsHeader.textContent = "Groups";
const groupsList = document.createElement("div");
groupsList.id = "groupsList";

// + New Group button
const newGroupBtn = document.createElement("button");
newGroupBtn.id = "newGroupBtn";
newGroupBtn.textContent = "+ New Group";
newGroupBtn.style.cssText = `
  width: 100%; padding: 12px; margin-top: 8px; border: none;
  background: linear-gradient(90deg, #386fa4, #2d4a7c); color: #fff;
  font-weight: bold; border-radius: 8px; cursor: pointer;
  transition: transform .2s, box-shadow .2s;
`;
newGroupBtn.onmouseenter = () => (newGroupBtn.style.boxShadow = "0 3px 10px rgba(56,111,164,0.4)");
newGroupBtn.onmouseleave = () => (newGroupBtn.style.boxShadow = "");

// Insert into sidebar
discoverList.insertAdjacentElement("afterend", groupsHeader);
groupsHeader.insertAdjacentElement("afterend", groupsList);
groupsList.insertAdjacentElement("afterend", newGroupBtn);

// Data structures
let myGroups = new Set();                 // e.g., "group:friends"
let groupsMeta = {};                      // key -> { id, members, createdBy, createdAt }

function parseMembers(raw) {
  if (!raw) return [];
  return Array.from(new Set(
    raw.split(",").map(s => s.trim()).filter(Boolean)
  )).filter(u => u.length <= 32);
}

// Event delegation for all group items (dynamically created)
groupsList.addEventListener("click", (e) => {
  const groupEl = e.target.closest(".group-entry");
  if (!groupEl) return;

  const groupName = groupEl.dataset.group;
  if (!groupName) return;

  openTab(`group:${groupName}`);
});

// Create a new group
newGroupBtn.onclick = async () => {
  let name = prompt("Enter a group name (letters, numbers, -, _ ; max 30 chars):");
  if (!name) return;
  name = name.trim().toLowerCase().replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!name) return alert("Invalid name.");
  if (name.length > 30) name = name.slice(0, 30);

  const extra = prompt("Add members (comma-separated usernames), optional:");
  const members = parseMembers(extra).filter(u => u !== loggedInUser);

  try {
    await setDoc(doc(db, "groups", name), {
      members: [loggedInUser],
      createdBy: loggedInUser,
      createdAt: Date.now()
    }, { merge: true });

    if (members.length) {
      await updateDoc(doc(db, "groups", name), { members: arrayUnion(...members) });
    }

    // Add group to UI immediately
    const groupItem = document.createElement("div");
    groupItem.className = "group-entry";
    groupItem.dataset.group = name;
    groupItem.textContent = name;
    groupItem.style.cssText = `
      padding: 8px 12px; margin-bottom: 6px;
      border-radius: 10px; background: #1b3a73;
      cursor: pointer; transition: all 0.2s;
    `;
    groupItem.onmouseenter = () => groupItem.style.background = "#2a4d8c";
    groupItem.onmouseleave = () => groupItem.style.background = "#1b3a73";

    groupsList.appendChild(groupItem);

    openTab(`group:${name}`);
  } catch (e) {
    console.error(e);
    alert("Could not create group. Check console for details.");
  }
};

// Live groups list (incremental render could be added later; keep simple for now)
onSnapshot(collection(db, "groups"), (snap) => {
  groupsList.innerHTML = "";
  myGroups = new Set();
  groupsMeta = {};

  snap.forEach((docSnap) => {
    const g = docSnap.data();
    const id = docSnap.id;
    const key = `group:${id}`;
    if (!Array.isArray(g.members)) return;

    if (g.members.includes(loggedInUser)) {
      myGroups.add(key);
      groupsMeta[key] = { id, ...g };

      const div = document.createElement("div");
      div.className = "online-user";
      div.dataset.user = key;

      const left = document.createElement("div");
      left.style.display = "flex";
      left.style.flexDirection = "column";
      const label = document.createElement("span");
      label.textContent = `#${id}`;
      left.appendChild(label);

      const small = document.createElement("span");
      small.className = "last-seen";
      small.textContent = `${g.members.length} member${g.members.length === 1 ? "" : "s"}`;
      left.appendChild(small);
      div.appendChild(left);

      const right = document.createElement("div");
      right.style.display = "flex";
      right.style.alignItems = "center";

      const unreadHolder = document.createElement("span");
      unreadHolder.className = "unread-holder";
      right.appendChild(unreadHolder);
        
      const mkBtn = (txt, title) => {
        const b = document.createElement("button");
        b.textContent = txt;
        b.title = title;
        b.className = "action-btn";
        return b;
      };

      const inviteBtn = mkBtn("＋", "Invite members");
      inviteBtn.onclick = async (e) => {
        e.stopPropagation();
        const raw = prompt("Usernames to invite (comma-separated):");
        const toAdd = parseMembers(raw).filter(Boolean);
        if (!toAdd.length) return;
        try { await updateDoc(doc(db, "groups", id), { members: arrayUnion(...toAdd) }); }
        catch (err) { console.error(err); alert("Failed to invite."); }
      };
      right.appendChild(inviteBtn);

      const leaveBtn = mkBtn("⎋", "Leave group");
      leaveBtn.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`Leave #${id}?`)) return;
        try {
          await updateDoc(doc(db, "groups", id), { members: arrayRemove(loggedInUser) });
          if (activeTab === key) {
            activeTab = "all"; highlightActiveTab(); displayMessages();
          }
        } catch (err) { console.error(err); alert("Failed to leave."); }
      };
      right.appendChild(leaveBtn);

      const canDelete = (g.createdBy === loggedInUser) || isAdmin;
      if (canDelete) {
        const delBtn = mkBtn("🗑", "Delete group");
        delBtn.onclick = async (e) => {
          e.stopPropagation();
          if (!confirm(`Delete #${id} for everyone? This removes history (within retention window).`)) return;
          try {
            await deleteDoc(doc(db, "groups", id));
            if (activeTab === key) {
              activeTab = "all"; highlightActiveTab(); displayMessages();
            }
          } catch (err) { console.error(err); alert("Failed to delete group."); }
        };
        right.appendChild(delBtn);
      }

      div.appendChild(right);
      div.onclick = () => openTab(key);

      groupsList.appendChild(div);
      updateUnreadBadge(key);
    }
  });
});
// JS
const avatarInput = document.getElementById("avatarInput");
const myAvatarImg = document.getElementById("myAvatarImg");

// Load saved avatar on page load
const savedAvatar = localStorage.getItem("myAvatar");
if (savedAvatar) {
  myAvatarImg.src = savedAvatar;
}

// Handle file selection
avatarInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (file.size > 2 * 1024 * 1024) { // 2MB limit
    alert("File too large! Max 2MB.");
    avatarInput.value = "";
    return;
  }

  try {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataURL = ev.target.result;
      localStorage.setItem("myAvatar", dataURL); // Save
      myAvatarImg.src = dataURL; // Update UI
      alert("Profile picture updated!");
    };
    reader.readAsDataURL(file);
  } catch (err) {
    console.error(err);
    alert("Failed to load image.");
  }
});

/* ===== Tabs ===== */
const tabsContainer = document.getElementById("tabs");
let openTabs = {};
let activeTab = "all";

function labelForTab(key) {
  if (key === "all") return "All Chat";
  if (isGroupKey(key)) return `#${groupNameFromKey(key)}`;
  return key;
}

function openTab(key) {
  if (!openTabs[key]) {
    const tab = document.createElement("div");
    tab.className = "tab" + (key === activeTab ? " active" : "");
    tab.dataset.user = key;
    tab.textContent = labelForTab(key);

    if (key !== "all") {
      const closeBtn = document.createElement("span");
      closeBtn.textContent = "✖";
      closeBtn.className = "close-btn";
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        tabsContainer.removeChild(tab);
        delete openTabs[key];
        if (activeTab === key) { activeTab = "all"; highlightActiveTab(); displayMessages(); }
      };
      tab.appendChild(closeBtn);
    }

    tab.onclick = () => {
      activeTab = key;
      if (unreadCounts[key]) unreadCounts[key] = 0;
      if (unreadMessageIds[key]) unreadMessageIds[key].clear();
      updateUnreadBadge(key);
      highlightActiveTab();
      displayMessages();
    };

    openTabs[key] = tab;
    tabsContainer.appendChild(tab);
    updateUnreadBadge(key);
  }

  activeTab = key;
  if (unreadCounts[key]) unreadCounts[key] = 0;
  if (unreadMessageIds[key]) unreadMessageIds[key].clear();
  updateUnreadBadge(key);
  highlightActiveTab();
  displayMessages();
}
function highlightActiveTab() {
  Object.values(openTabs).forEach((tab) => tab.classList.remove("active"));
  if (openTabs[activeTab]) openTabs[activeTab].classList.add("active");
}
// --- Unified sendMessage with typing + timestamp support ---
async function sendMessage() {
  let text = document.getElementById("noteInput").value.trim();
  if (!text) return;

  const isDM = !isGroupKey(activeTab) && activeTab !== "all";
  const isFriend = friendsAccepted.has(activeTab);

  if (isDM && !isFriend) {
    alert("You can only message users you are friends with.");
    return;
  }

  // Prevent posting to groups you left
  if (isGroupKey(activeTab) && !myGroups.has(activeTab)) {
    alert("You are not a member of this group.");
    return;
  }

  const targetIsGroup = isGroupKey(activeTab);
  const groupId = targetIsGroup ? groupNameFromKey(activeTab) : null;

  // Pick the right collection
  const msgCol = targetIsGroup
    ? collection(db, "groups", groupId, "messages")
    : collection(db, "messages");

  // Handle URLs as attachments
  if (looksLikeUrl(text)) {
    await addDoc(msgCol, {
      text: "",
      from: loggedInUser,
      to: activeTab,
      timestamp: Date.now(),
      fileURL: text,
      fileName: text.split("/").pop().split("?")[0],
    });
    document.getElementById("noteInput").value = "";
    // reset typing
    await setDoc(doc(db, "presence", loggedInUser), { typing: false }, { merge: true });
    return;
  }

  const maxLength = 350;
  if (text.length > maxLength) {
    alert(`Message too long! Limit is ${maxLength} characters.`);
    return;
  }

  text = filterProfanity(text);

  await addDoc(msgCol, {
    text,
    from: loggedInUser,
    to: activeTab,
    timestamp: Date.now(),
  });

  document.getElementById("noteInput").value = "";

  // reset typing after sending
  await setDoc(doc(db, "presence", loggedInUser), { typing: false }, { merge: true });
}


const toggleBtn = document.getElementById("toggleSidebar");
const chat = document.getElementById("chatContainer");

// Make sure sidebar starts hidden
sidebar.classList.add("hidden");
chat.style.marginRight = "0";

toggleBtn.addEventListener("click", () => {
  const isHidden = sidebar.classList.contains("hidden");

  if (isHidden) {
    // Show sidebar
    sidebar.classList.remove("hidden");
    sidebar.classList.add("visible");
    chat.style.marginRight = sidebar.offsetWidth + "px";
  } else {
    // Hide sidebar
    sidebar.classList.remove("visible");
    sidebar.classList.add("hidden");
    chat.style.marginRight = "0";
  }
});


document.getElementById("sendBtn").onclick = sendMessage;
document.getElementById("noteInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); sendMessage(); }
});

const q = query(collection(db, "messages"), orderBy("timestamp"));
onSnapshot(q, (snapshot) => {
  snapshot.docChanges().forEach((change) => {
    const data = change.doc.data();
    const id = change.doc.id;

    if (change.type === "added") {
      if (!data || typeof data.timestamp !== "number") return;
      mergeMessage({ id, data });
    }

    if (change.type === "modified") {
      if (!data || typeof data.timestamp !== "number") return;
      mergeMessage({ id, data }); // update content if edited
    }

    if (change.type === "removed") {
      // Remove from messagesByTab
      Object.keys(messagesByTab).forEach((key) => {
        messagesByTab[key] = messagesByTab[key].filter(m => m.id !== id);
        // Also update unread if needed
        if (unreadMessageIds[key]) unreadMessageIds[key].delete(id);
      });
    }
  });

  displayMessages();
});


/* ===== Group message listeners ===== */
let groupUnsubs = {};

function setupGroupListeners() {
  // remove old listeners
  Object.values(groupUnsubs).forEach(unsub => unsub());
  groupUnsubs = {};

  myGroups.forEach((key) => {
  const groupId = groupNameFromKey(key);
  const q = query(collection(db, "groups", groupId, "messages"), orderBy("timestamp"));

  groupUnsubs[key] = onSnapshot(q, (snapshot) => {
  snapshot.docChanges().forEach((change) => {
    const data = change.doc.data();
    const id = change.doc.id;

    if (change.type === "added" || change.type === "modified") {
      if (!data || typeof data.timestamp !== "number") return;
      mergeMessage({ id, data });
    }

    if (change.type === "removed") {
      if (!messagesByTab[key]) return;
      messagesByTab[key] = messagesByTab[key].filter(m => m.id !== id);
      if (unreadMessageIds[key]) unreadMessageIds[key].delete(id);
    }
  });

  displayMessages();
});

});

}

// Call it whenever groups membership changes
onSnapshot(collection(db, "groups"), (snap) => {
  // … your existing groups list rebuild …
  setupGroupListeners();
});

/* ===== Messages ===== */
const notesList = document.getElementById("notesList");
let allMessages = [];  // ← Add this so displayMessages can use it



// Track messages separately to avoid duplicates
let messagesByTab = {}; // key = "all", username, or group:groupName, value = array of messages
displayMessages();

function displayMessages() {
  notesList.innerHTML = "";

  // Get the messages for the current tab only
  const tabKey = activeTab;
  const messages = messagesByTab[tabKey] || [];

  messages.forEach(({ id, data }) => {
    renderMessage({ id }, data);

    // Mark as read in unread tracking
    if (unreadMessageIds[tabKey]) unreadMessageIds[tabKey].delete(id);
  });

  notesList.scrollTop = notesList.scrollHeight;

  // Update unread badges
  Object.keys(unreadCounts).forEach((key) => updateUnreadBadge(key));
}

// Add a helper to merge new messages into messagesByTab
function mergeMessage(msg) {
  const { id, data } = msg;
  let key;

  if (isGroupKey(data.to)) key = data.to;
  else if (data.to === "all") key = "all";
  else key = data.from === loggedInUser ? data.to : data.from;

  if (!messagesByTab[key]) messagesByTab[key] = [];
  messagesByTab[key] = messagesByTab[key].filter(m => m.id !== id); // remove duplicates
  messagesByTab[key].push(msg);

  // Track unread
  const isDMToMe = key !== "all" && !isGroupKey(key) && data.to === loggedInUser && data.from !== loggedInUser;
  if ((isDMToMe || (key === "all" && data.from !== loggedInUser) || (isGroupKey(key) && data.from !== loggedInUser && !myGroups.has(key)))) {
    if (!unreadMessageIds[key]) unreadMessageIds[key] = new Set();
    if (!unreadMessageIds[key].has(id)) {
      unreadMessageIds[key].add(id);
      unreadCounts[key] = (unreadCounts[key] || 0) + 1;
    }
  }
}

// ================== Globals ==================
const mutedUsers = new Set();

// ================== Message Renderer ==================
function renderMessage(docSnap, data) {
  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;

  // Skip muted users
  if (mutedUsers.has(data.from)) return;

  // Handle Firestore timestamp
  let msgTime = data.timestamp;
  if (msgTime && typeof msgTime.toMillis === "function") {
    msgTime = msgTime.toMillis();
  }

  // Auto-delete old messages
  if (msgTime && now - msgTime > ONE_HOUR) {
    (async () => {
      try {
        const targetCollection = isGroupKey(data.to)
          ? collection(db, "groups", groupNameFromKey(data.to), "messages")
          : collection(db, "messages");
        await deleteDoc(doc(targetCollection, docSnap.id));
        console.log("Auto-deleted old message:", docSnap.id);
      } catch (err) {
        console.error("Failed to auto-delete old message:", err);
      }
    })();
    return; // Don’t render after deletion
  }

  // --- Create container ---
  const div = document.createElement("div");
  div.className = "note-item";

  // Avatar
  const avatarImg = document.createElement("img");
  avatarImg.src = `https://i.pravatar.cc/30?u=${data.from}`;
  div.appendChild(avatarImg);

  // Message text
  const content = document.createElement("span");
  if (isGroupKey(data.to)) {
    content.textContent = `#${groupNameFromKey(data.to)} • ${data.from}: ${data.text || data.fileName || ""}`;
  } else if (data.to !== "all" && data.to !== loggedInUser && data.from === loggedInUser) {
    content.textContent = `${data.from} → ${data.to}: ${data.text || data.fileName || ""}`;
  } else {
    content.textContent = `${data.from}: ${data.text || data.fileName || ""}`;
  }
  div.appendChild(content);

  // --- Attachments ---
  if (data.fileURL) {
    div.appendChild(document.createTextNode(" "));

    const fileLink = document.createElement("a");
    fileLink.href = data.fileURL;
    fileLink.target = "_blank";
    fileLink.rel = "noopener noreferrer";
    fileLink.textContent = data.fileName || "File";
    fileLink.style.color = "#ff8800";
    fileLink.style.textDecoration = "underline";
    div.appendChild(fileLink);

    if (isImageUrl(data.fileURL)) {
      const preview = document.createElement("img");
      preview.src = data.fileURL;
      preview.alt = data.fileName || "attachment";
      Object.assign(preview.style, {
        width: "120px",
        height: "auto",
        borderRadius: "8px",
        marginLeft: "8px",
        cursor: "pointer",
      });
      preview.onclick = () => window.open(data.fileURL, "_blank");
      div.appendChild(preview);
    }
  }

  // --- Timestamp ---
  if (data.timestamp) {
    const timeSpan = document.createElement("span");
    timeSpan.className = "timestamp";
    Object.assign(timeSpan.style, {
      marginLeft: "8px",
      fontSize: "11px",
      color: "#aaa",
    });
    timeSpan.textContent = timeAgo(data.timestamp);
    div.appendChild(timeSpan);
  }

  // --- Styling for roles ---
  if (data.from === ADMIN_USER) div.classList.add("admin-message");
  if (data.from === loggedInUser) div.classList.add("own-message");
  else if (data.to === loggedInUser && data.to !== "all") div.classList.add("private-message");

  // --- Delete button ---
  let canDelete = isAdmin || data.from === loggedInUser;
  if (isGroupKey(data.to)) {
    const group = groupsMeta[data.to];
    if (group && group.createdBy === loggedInUser) canDelete = true;
  }

  if (canDelete) {
    const delBtn = document.createElement("button");
    delBtn.textContent = "✖";
    delBtn.className = "delete-btn";
    delBtn.title = "Delete message";
    delBtn.onclick = async (e) => {
      e.stopPropagation();
      try {
        const targetCollection = isGroupKey(data.to)
          ? collection(db, "groups", groupNameFromKey(data.to), "messages")
          : collection(db, "messages");
        await deleteDoc(doc(targetCollection, docSnap.id));
      } catch (err) {
        console.error(err);
        alert("Failed to delete message.");
      }
    };
    div.appendChild(delBtn);
  }

  notesList.appendChild(div);
}




function updateUnreadBadge(user) {
  const row = document.querySelector(`.online-user[data-user="${CSS.escape(user)}"]`);
  if (!row) return;

  let count = unreadCounts[user] || 0;

  // Also count messages in DM tabs even if not friends
  if (user !== "all" && !friendsAccepted.has(user)) {
    const messages = messagesByTab[user] || [];
    count = messages.filter(m => m.from === user && m.to === loggedInUser).length;
  }

  let holder = row.querySelector(".unread-holder");
  if (!holder) {
    holder = document.createElement("span");
    holder.className = "unread-holder";
    row.appendChild(holder);
  }

  holder.innerHTML = "";
  if (count > 0) {
    const badge = document.createElement("span");
    badge.className = "unread-badge";
    badge.textContent = count;
    holder.appendChild(badge);
  }
}

/* Init */
document.getElementById("chatAllBtn").onclick = () => openTab("all");
openTab("all");



/* Attachments (paste a URL) */
const attachBtn = document.getElementById("attachBtn");
attachBtn.onclick = async () => {
  const url = prompt("Paste a direct link to an image/file (e.g., https://i.imgur.com/abc123.png):");
  if (!url) return;
  await addDoc(collection(db, "messages"), {
    text: "",
    from: loggedInUser,
    to: activeTab,
    timestamp: Date.now(),
    fileURL: url,
    fileName: url.split("/").pop().split("?")[0],
  });
};

/* Inline color picker */
window.changeBackground = function changeBackground() {
  const notesList2 = document.getElementById("notesList");
  const val = document.getElementById("bgSelector").value;
  notesList2.style.backgroundColor = val;
};

/* News modal behavior */
const NEWS_VERSION = "1"; // bump when you change content
const newsOverlay = document.getElementById("newsOverlay");
const showNews = () => { newsOverlay.style.display = "flex"; };
const hideNews = () => { newsOverlay.style.display = "none"; };

// Open once if not seen
if (localStorage.getItem("kitchatty_news_version") !== NEWS_VERSION) {
  showNews();
}

document.getElementById("closeNewsBtn").onclick = hideNews;
document.getElementById("ackNewsBtn").onclick = () => { hideNews(); localStorage.setItem("kitchatty_news_version", NEWS_VERSION); };
document.getElementById("dontShowNewsBtn").onclick = () => { localStorage.setItem("kitchatty_news_version", NEWS_VERSION); hideNews(); };
document.getElementById("showNewsBtn").onclick = showNews;

// Escape key closes
window.addEventListener("keydown", (e) => { if (e.key === "Escape") hideNews(); });

/* Lightweight runtime checks */
console.assert(typeof window.changeBackground === "function", "changeBackground not attached to window");
console.assert(typeof addDoc === "function", "Firestore import missing");

// Utility: how long ago
function timeAgo(ts) {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? "s" : ""} ago`;
}

const messageInput = document.getElementById("noteInput");
const typingIndicator = document.getElementById("typingIndicator");

let isTyping = false;
let lastTyped = 0;
const TYPING_DELAY = 3000; // 3 seconds inactivity before local timer
const CHECK_INTERVAL = 7000; // 7 seconds to verify typing

// --- Update typing state locally ---
messageInput.addEventListener("input", () => {
  lastTyped = Date.now();

  if (!isTyping) {
    isTyping = true;
    setDoc(doc(db, "presence", loggedInUser), {
      typing: true,
      lastUpdate: lastTyped
    }, { merge: true });
  }
});

// --- Periodically check if user stopped typing ---
setInterval(() => {
  if (isTyping && Date.now() - lastTyped > TYPING_DELAY) {
    isTyping = false;
    setDoc(doc(db, "presence", loggedInUser), {
      typing: false,
      lastUpdate: Date.now()
    }, { merge: true });
  }
}, CHECK_INTERVAL);

// --- Watch all users' typing status ---
function watchAllTypingStatus() {
  onSnapshot(collection(db, "presence"), (snapshot) => {
    const now = Date.now();
    const activeTyping = [];

    snapshot.docs.forEach(docSnap => {
      const data = docSnap.data();
      const user = docSnap.id;

      // Only show typing if updated in last 7s and not yourself
      if (data?.typing && data.lastUpdate && now - data.lastUpdate < CHECK_INTERVAL && user !== loggedInUser) {
        activeTyping.push(user);
      }
    });

    typingIndicator.textContent = activeTyping.length
      ? activeTyping.join(", ") + " is typing..."
      : "";
  });
}

// Start watching all users
watchAllTypingStatus();


// --- Listen for new messages in a chat ---
function watchMessages(chatId) {
  onSnapshot(
    collection(db, "chats", chatId, "messages"),
    (snap) => {
      messagesContainer.innerHTML = "";
      snap.forEach((docSnap) => {
        renderMessage(docSnap.data());
      });
    }
  );
}
