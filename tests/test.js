let i = 0;
let success = 0;
let failure = 0;

function test(truthy, message) {
  const idx = String(i).padStart(3, '0');
  if (truthy) {
    console.log(`🟢 ${idx} - ${message}`);
    success += 1;
    update('success', success);
  } else {
    console.error(`🔴 ${idx} - ${message}`);
    failure += 1;
    update('failure', failure);
  }

  update('total', success + failure);
  i += 1;
}

function update(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.innerText = value;
  }
}
