import * as fs from 'fs';

let code = fs.readFileSync('src/App.tsx', 'utf-8');

// Clean up duplicate aria-labels
code = code.replace(/aria-label="Profile" aria-label="Profile"/g, 'aria-label="Profile"');

// Fix dynamic titles like title={msg.isPinned ? "Unpin" : "Pin"} to also have aria-label
code = code.replace(/title=\{([^}]+)\}/g, (match, expression) => {
  if (match.includes('aria-label')) return match;
  return `title={${expression}} aria-label={${expression}}`;
});

// Fix static titles missing aria-label
code = code.replace(/title="([^"]+)"/g, (match, p1) => {
  if (match.includes('aria-label')) return match;
  return `title="${p1}" aria-label="${p1}"`;
});

// Add aria-label to textarea
code = code.replace(/<textarea([^>]*)id="chat-input"/, '<textarea$1id="chat-input" aria-label="Chat message input"');
code = code.replace(/<textarea \n                             className="w-full bg-transparent/, '<textarea aria-label="Edit message" \n                             className="w-full bg-transparent');

// Add aria-label to inputs
code = code.replace(/<input\n                type="text"\n                placeholder="Search/, '<input\n                type="text"\n                aria-label="Search history"\n                placeholder="Search');

// Ensure other options have aria-label
code = code.replace(/<select \n                     className="bg-theme-bg/g, '<select aria-label="Filter by details"\n                     className="bg-theme-bg');

fs.writeFileSync('src/App.tsx', code);
console.log("Replaced successfully!");
