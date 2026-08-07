export function calculateQuickExpression(rawExpression) {
  const source = String(rawExpression || "").replace(/\s+/g, "");
  if (!source || !/^[0-9+\-*/().%]+$/.test(source)) {
    throw new Error("Enter a valid calculation");
  }

  let position = 0;

  const parseNumber = () => {
    const start = position;
    while (position < source.length && /[0-9.]/.test(source[position])) position += 1;
    const token = source.slice(start, position);
    if (!token || (token.match(/\./g) || []).length > 1) throw new Error("Invalid number");
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error("Invalid number");
    return value;
  };

  const parseFactor = () => {
    let sign = 1;
    while (source[position] === "+" || source[position] === "-") {
      if (source[position] === "-") sign *= -1;
      position += 1;
    }

    let value;
    if (source[position] === "(") {
      position += 1;
      value = parseExpression();
      if (source[position] !== ")") throw new Error("Missing closing bracket");
      position += 1;
    } else {
      value = parseNumber();
    }

    while (source[position] === "%") {
      value /= 100;
      position += 1;
    }
    return sign * value;
  };

  const parseTerm = () => {
    let value = parseFactor();
    while (source[position] === "*" || source[position] === "/") {
      const operator = source[position];
      position += 1;
      const next = parseFactor();
      if (operator === "/" && next === 0) throw new Error("Cannot divide by zero");
      value = operator === "*" ? value * next : value / next;
    }
    return value;
  };

  const parseExpression = () => {
    let value = parseTerm();
    while (source[position] === "+" || source[position] === "-") {
      const operator = source[position];
      position += 1;
      const next = parseTerm();
      value = operator === "+" ? value + next : value - next;
    }
    return value;
  };

  const result = parseExpression();
  if (position !== source.length || !Number.isFinite(result)) throw new Error("Invalid calculation");
  return Number(result.toFixed(8));
}

export function formatQuickTimer(totalSeconds = 0) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return [hours, minutes, remaining].map((value) => String(value).padStart(2, "0")).join(":");
}
