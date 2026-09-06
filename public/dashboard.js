const stageElements = new Map();
const list = document.getElementById("stages");
const source = new EventSource("/events");

source.onmessage = (event) => {
  const data = JSON.parse(event.data);
  let item = stageElements.get(data.stage);
  if (!item) {
    item = document.createElement("li");
    stageElements.set(data.stage, item);
    list.appendChild(item);
  }
  item.textContent = "";
  item.appendChild(document.createTextNode(`${data.stage}: ${data.status} - `));
  if (typeof data.message === "string" && /^https?:\/\//.test(data.message)) {
    const link = document.createElement("a");
    link.href = data.message;
    link.target = "_blank";
    link.textContent = data.message;
    item.appendChild(link);
  } else {
    item.appendChild(document.createTextNode(data.message));
  }
};
