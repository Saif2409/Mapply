/**
 * Builds a self-contained script that fills an application form.
 *
 * Runs inside the embedded browser via webview.executeJavaScript, so it must be
 * a single expression with no imports and no reliance on anything in this app.
 *
 * Deliberately generic rather than per-site: forms overwhelmingly follow the
 * same conventions (autocomplete tokens, name/id patterns, a <label> beside the
 * input), so one matcher covers Greenhouse, Workday, Oracle and a company's
 * hand-rolled form alike. Per-site adapters are only worth writing where a form
 * breaks those conventions.
 *
 * It never submits anything, and never touches a field the user already filled.
 */

// Ordered: the first rule that matches a field wins, so put the specific ones
// first ("first name" before the looser "name").
const RULES = [
  ["first_name", /\b(first[\s_-]*name|given[\s_-]*name|fname|forename)\b/i],
  ["last_name", /\b(last[\s_-]*name|family[\s_-]*name|surname|lname)\b/i],
  ["full_name", /\b(full[\s_-]*name|your[\s_-]*name|candidate[\s_-]*name|^name$)\b/i],
  ["email", /\b(e[\s_-]*mail|email[\s_-]*address)\b/i],
  ["phone", /\b(phone|mobile|tel|contact[\s_-]*number|cell)\b/i],
  ["linkedin", /\b(linked[\s_-]*in)\b/i],
  ["github", /\b(github|git[\s_-]*hub)\b/i],
  ["portfolio", /\b(portfolio|website|personal[\s_-]*site|web[\s_-]*page)\b/i],
  ["city", /\b(city|town)\b/i],
  ["country", /\b(country)\b/i],
  ["location", /\b(location|address|based[\s_-]*in|current[\s_-]*residence)\b/i],
  ["university", /\b(university|school|college|institution)\b/i],
  ["degree", /\b(degree|qualification|major|field[\s_-]*of[\s_-]*study)\b/i],
  ["graduation_year", /\b(graduation|grad[\s_-]*year|year[\s_-]*of[\s_-]*graduation)\b/i],
  ["languages", /\b(languages?)\b/i],
  ["driving_license", /\b(driv(ing|er).?s?[\s_-]*licen[cs]e)\b/i],
  ["visa_status", /\b(visa|residency|work[\s_-]*permit|iqama)\b/i],
  ["work_authorised", /\b(authoriz|authoris|eligible to work|right to work|legally)\b/i],
  ["needs_sponsorship", /\b(sponsor)\b/i],
];

export function buildFillScript(values) {
  const payload = JSON.stringify(values);
  const rules = JSON.stringify(RULES.map(([k, r]) => [k, r.source, r.flags]));

  return `(() => {
  const VALUES = ${payload};
  const RULES = ${rules}.map(([k, src, fl]) => [k, new RegExp(src, fl)]);

  // Everything a human would read as this field's label.
  const describe = (el) => {
    const bits = [el.name, el.id, el.placeholder, el.getAttribute('aria-label'),
                  el.getAttribute('autocomplete'), el.getAttribute('data-qa')];
    if (el.labels) for (const l of el.labels) bits.push(l.innerText);
    const wrap = el.closest('label, .field, [class*="field"], [class*="form-group"]');
    if (wrap) bits.push(wrap.innerText.slice(0, 120));
    return bits.filter(Boolean).join(' ');
  };

  // React and Angular track value internally; assigning .value alone leaves
  // their state stale and the form submits empty. Go through the native setter
  // and fire the events their listeners expect.
  const setValue = (el, val) => {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const AUTOCOMPLETE = {
    'given-name': 'first_name', 'family-name': 'last_name', 'name': 'full_name',
    'email': 'email', 'tel': 'phone', 'country-name': 'country',
    'address-level2': 'city', 'url': 'portfolio',
  };

  const filled = [];
  const skipped = [];
  const fields = document.querySelectorAll('input, textarea, select');

  for (const el of fields) {
    const type = (el.type || '').toLowerCase();
    if (['hidden','submit','button','file','password','checkbox','radio'].includes(type)) continue;
    if (el.disabled || el.readOnly || el.offsetParent === null) continue;
    if (el.value && el.value.trim()) { skipped.push('already filled'); continue; }

    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    let key = AUTOCOMPLETE[ac] || null;
    if (!key) {
      const hay = describe(el);
      for (const [k, re] of RULES) { if (re.test(hay)) { key = k; break; } }
    }
    const val = key && VALUES[key];
    if (!val) continue;

    if (el.tagName === 'SELECT') {
      const want = String(val).toLowerCase();
      const opt = [...el.options].find(o =>
        o.text.toLowerCase().includes(want) || want.includes(o.text.toLowerCase()));
      if (!opt) continue;
      el.value = opt.value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      setValue(el, val);
    }
    el.style.outline = '2px solid #22c55e';
    el.style.outlineOffset = '1px';
    filled.push(key);
  }
  return { filled, count: filled.length, fieldsSeen: fields.length };
})()`;
}
