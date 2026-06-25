import React, { useState } from 'react';
import { render, Box, Text, useApp, useInput } from 'ink';

function Probe() {
  const { exit } = useApp();
  const [rows, setRows] = useState<string[]>([]);

  useInput((input, key) => {
    if (input === 'q') {
      exit();
      return;
    }
    // Show the raw bytes + Ink's decoded key flags for whatever was pressed.
    const bytes = [...input].map((c) => c.charCodeAt(0)).join(',');
    const flags = Object.entries(key)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join('+');
    setRows((r) =>
      [...r, `bytes=[${bytes}] "${input.replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\x1b/g, 'ESC')}" key=${flags || '(none)'}`].slice(-12)
    );
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan">
        Key probe. Press, in order: Enter, then Shift+Enter, then Option/Alt+Enter,
        then Ctrl+J. Press q to quit.
      </Text>
      {rows.map((r, i) => (
        <Text key={i}>{r}</Text>
      ))}
    </Box>
  );
}

render(<Probe />);
