const splits = ['head', 'templates', 'body', 'script'];
const splitsEscaped = [
  'headEscaped',
  'templatesEscaped',
  'bodyEscaped',
  'scriptEscaped',
];

class Manager {
  raw = '';
  containers = {
    view: null,
    head: null,
    templates: null,
    body: null,
    script: null,
    html: null,
  };
  displays = {
    head: null,
    templates: null,
    body: null,
    script: null,
    html: null,
  };
  editors = { head: null, templates: null, body: null, script: null };
  splits = { head: '', templates: '', body: '', script: '' };

  constructor() {
    const proxy = new Proxy(this, handler);
    window.addEventListener('DOMContentLoaded', this.load.bind(proxy));
    return proxy;
  }

  async load() {
    const resp = await fetch('./inventory.html');
    this.raw = await resp.text();
    this.setSplits();
    this.setRefs();
    this.setRefContents();
    this.setRefListeners();
    this.setView();
    highlight();
    centerView();
  }

  reset() {
    this.setSplits();
    this.setRefs();
    this.setRefContents();
    this.setView();
    highlight();
    centerView();
  }

  setRefs() {
    for (const id of splits) {
      const el = document.getElementById(id);
      this.containers[id] = el;
      this.displays[id] = el.getElementsByTagName('code')[0];
      this.editors[id] = el.getElementsByTagName('textarea')[0];
    }

    this.containers.view = document.getElementById('view');

    const el = document.getElementById('html');
    this.containers.html = el;
    this.displays.html = el.getElementsByTagName('code')[0];
  }

  setRefContents() {
    for (const id of splits) {
      this.editors[id].value = this[id];
      this.displays[id].innerHTML = this[`${id}Escaped`];
    }

    this.displays.html.innerHTML = this.htmlEscaped;
  }

  setRefListeners() {
    for (const id of splits) {
      this.editors[id].onblur = this.getBlurHandler(id);
      this.displays[id].onclick = this.getClickHandler(id);
    }

    const tabs = document.getElementById('tabs');
    for (const button of tabs.children) {
      button.onclick = this.toggleScreen.bind(this);
    }

    document.getElementById('reset').onclick = this.reset.bind(this);
  }

  getBlurHandler(id) {
    return () => {
      const value = this.editors[id].value;
      if (value !== this.splits[id]) {
        this.splits[id] = value;
        this.displays[id].innerHTML = this[`${id}Escaped`];
        this.displays.html.innerHTML = this.htmlEscaped;
        this.setView();
        highlight();
      }

      this.editors[id].style.display = 'none';
      this.displays[id].parentElement.style.display = 'block';
    };
  }

  getClickHandler(id) {
    return () => {
      this.displays[id].parentElement.style.display = 'none';
      this.editors[id].style.display = 'block';
      setTimeout(() => this.editors[id].focus(), 50);
    };
  }

  setSplits() {
    this.splits.head = this.getPart('HEAD_START', 'HEAD_END');
    this.splits.templates = this.getPart('TEMPLATES_START', 'TEMPLATES_END');
    this.splits.body = this.getPart('BODY_START', 'BODY_END');
    this.splits.script = this.getPart('LOGIC_START', 'LOGIC_END');
  }

  getPart(starttag, endtag) {
    const splits = this.raw.split('\n');
    const start = splits.findIndex((l) => l.includes(starttag));
    const end = splits.findIndex((l) => l.includes(endtag));
    return splits.slice(start + 1, end).join('\n');
  }

  setView() {
    for (const ch of this.containers.view.children) {
      ch.remove();
    }

    const ifr = document.createElement('iframe');
    this.containers.view.appendChild(ifr);
    ifr.src = 'about:blank';
    ifr.contentWindow.document.open();
    ifr.contentWindow.document.write(this.html);
    ifr.contentWindow.document.close();
  }

  toggleScreen(e) {
    const tab = e.target.dataset.tab;
    for (const key in this.containers) {
      const el = this.containers[key];
      if (key === tab) {
        el.style.display = 'block';
      } else {
        el.style.display = 'none';
      }
    }

    const tabs = document.getElementById('tabs');
    for (const button of tabs.children) {
      button.setAttribute('data-active', 'false');
    }
    e.target.setAttribute('data-active', 'true');
  }
}

const handler = {
  get(target, prop) {
    if (typeof prop !== 'string') {
      return Reflect.get(target, prop);
    }

    if (prop === 'html') {
      return html(target);
    }

    if (prop === 'htmlEscaped') {
      return escapeHTML(html(target));
    }

    if (splits.includes(prop)) {
      return Reflect.get(target, 'splits')[prop];
    }

    if (splitsEscaped.includes(prop)) {
      const newprop = prop.replace('Escaped', '');
      return escapeHTML(Reflect.get(target, 'splits')[newprop]);
    }

    return Reflect.get(target, prop);
  },
};

function html(target) {
  const head = `  <head>\n${lpad(target.splits.head, '    ')}\n  </head>\n`;
  const templates = lpad(target.splits.templates, '  ');
  const body = `\n  <body>\n${lpad(target.splits.body, '    ')}\n  </body>\n`;
  const script = `  <script>\n${lpad(
    target.splits.script,
    '    '
  )}\n  </script>`;

  const contents = [head, templates, body, script].join('\n');
  return `<html>\n${contents}\n</html>`;
}

function lpad(str, pad = '  ', delim = '\n') {
  return str
    .split(delim)
    .map((s) => `${pad}${s}`)
    .join(delim);
}

function escapeHTML(unsafe) {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function highlight(query) {
  if (typeof query !== 'string' || !query) {
    query = 'pre code';
  }

  document.querySelectorAll(query).forEach((el) => {
    hljs.highlightElement(el);
  });
}

function centerView() {
  const view = document.getElementById('view');
  const w1 = view.getBoundingClientRect().width;
  const w2 = view.firstChild.getBoundingClientRect().width;
  view.scroll((w2 - w1) / 2, 0);
}
