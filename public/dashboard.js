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
  item.textContent = `${data.stage}: ${data.status} - ${data.message}`;
};
