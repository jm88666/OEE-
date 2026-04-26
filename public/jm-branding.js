(() => {
  const APP_NAME = 'JMAnalyzeTool';
  const replacements = [
    [/OEE Analyse DW08/g, APP_NAME],
    [/OEE Dashboard — DW08/g, `${APP_NAME} Dashboard`],
    [/OEE Dashboard \u2014 DW08/g, `${APP_NAME} Dashboard`],
    [/Metsä NL Winschoten/g, APP_NAME],
    [/Mets\u00e4 NL Winschoten/g, APP_NAME],
    [/Metsa NL Winschoten/g, APP_NAME],
    [/DW08/g, 'Analyse'],
    [/metsa/g, APP_NAME],
  ];

  function replaceText(value) {
    return replacements.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), String(value || ''));
  }

  function applyBranding() {
    document.title = APP_NAME;

    const userInput = document.getElementById('l-user');
    if (userInput) userInput.placeholder = APP_NAME;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      const next = replaceText(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
    });

    document.querySelectorAll('[title]').forEach(el => {
      const next = replaceText(el.getAttribute('title'));
      if (next !== el.getAttribute('title')) el.setAttribute('title', next);
    });
  }

  const originalBuildPrompt = window.buildPrompt;
  if (typeof originalBuildPrompt === 'function') {
    window.buildPrompt = function brandedBuildPrompt(...args) {
      return replaceText(originalBuildPrompt.apply(this, args));
    };
  }

  const originalSwitchTab = window.switchTab;
  if (typeof originalSwitchTab === 'function') {
    window.switchTab = function brandedSwitchTab(...args) {
      const result = originalSwitchTab.apply(this, args);
      setTimeout(applyBranding, 0);
      return result;
    };
  }

  document.addEventListener('DOMContentLoaded', applyBranding);
  setTimeout(applyBranding, 0);
})();
