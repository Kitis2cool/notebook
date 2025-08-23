


if (localStorage.getItem("itemListNumber") === null) {
  localStorage.setItem("itemListNumber", "0");
}

function takeUserText() {
  return document.getElementById("userText").value.trim();
}

function addNew() {
  var userName = document.getElementById("username").value;
  var userText = takeUserText();
  var userText =  userName + ": " + userText
  if (!userText) return; // don’t save empty notes

  const inputField = document.getElementById("userText");
  const appent = document.getElementById("123");

  let ILN = parseInt(localStorage.getItem("itemListNumber"), 10);

  // Save new item
  localStorage.setItem(`note_${ILN}`, userText);

  // Append to DOM
  const element = document.createElement("p");
  element.textContent = userText;
  appent.appendChild(element);

  // Increment counter
  localStorage.setItem("itemListNumber", (ILN + 1).toString());

  inputField.value = "";
  console.log(`Saved: ${userText}, New ILN: ${ILN + 1}`);
}

function clearStorage() {
  localStorage.clear();
  localStorage.setItem("itemListNumber", "0");
  document.getElementById("123").innerHTML = "";
  console.log("Cleared localStorage");
}

// Load items on page load
function loadItems() {
  const appent = document.getElementById("123");
  let ILN = parseInt(localStorage.getItem("itemListNumber"), 10);

  for (let i = 0; i < ILN; i++) {
    const item = localStorage.getItem(`note_${i}`);
    if (item) {
      const element = document.createElement("p");
      element.textContent = item;
      appent.appendChild(element);
    }
  }
}

window.addEventListener("load", loadItems);






