if (localStorage.getItem("itemListNumber") === null) {
  localStorage.setItem("itemListNumber", "0");
}

function takeUserText() {
  return document.getElementById("userText").value.trim();
}

function addNew() {
  const userName = document.getElementById("username").value.trim();
  const text = takeUserText();

  // Don’t save empty notes or if no username
  if (!userName || !text) return;

  const userText = `${userName}: ${text}`;
  const inputField = document.getElementById("userText");
  const append = document.getElementById("123");

  let ILN = parseInt(localStorage.getItem("itemListNumber"), 10);

  // Save new item
  localStorage.setItem(`note_${ILN}`, userText);

  // Append to DOM
  const element = document.createElement("p");
  element.textContent = userText;
  append.appendChild(element);

  // Increment counter
  localStorage.setItem("itemListNumber", (ILN + 1).toString());

  inputField.value = "";
  console.log(`Saved: ${userText}, New ILN: ${ILN + 1}`);
}

function clearStorage() {
  let ILN = parseInt(localStorage.getItem("itemListNumber"), 10);
  for (let i = 0; i < ILN; i++) {
    localStorage.removeItem(`note_${i}`);
  }
  localStorage.setItem("itemListNumber", "0");
  document.getElementById("123").innerHTML = "";
  console.log("Cleared notes");
}

function loadItems() {
  const append = document.getElementById("123");
  let ILN = parseInt(localStorage.getItem("itemListNumber"), 10);

  for (let i = 0; i < ILN; i++) {
    const item = localStorage.getItem(`note_${i}`);
    if (item) {
      const element = document.createElement("p");
      element.textContent = item;
      append.appendChild(element);
    }
  }
}

window.addEventListener("load", loadItems);
