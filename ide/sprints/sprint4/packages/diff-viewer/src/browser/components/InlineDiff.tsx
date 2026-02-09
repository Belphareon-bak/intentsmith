/**
 * InlineDiff — Renders unified diff as colored lines.
 *
 * Used as fallback when Monaco diff editor is not available,
 * and in the Review Panel for quick preview.
 */

import * as React from 'react';

interface InlineDiffProps {
  diff: string;
  maxLines?: number;
}

export const InlineDiff: React.FC<InlineDiffProps> = ({ diff, maxLines }) => {
  const lines = diff.split('\n');
  const displayLines = maxLines ? lines.slice(0, maxLines) : lines;
  const truncated = maxLines && lines.length > maxLines;

  let oldLine = 0;
  let newLine = 0;

  return (
    <div className="c3-diff-inline">
      {displayLines.map((line, i) => {
        let className = 'c3-diff-line context';
        let lineNum = '';

        if (line.startsWith('@@')) {
          // Parse hunk header to get line numbers
          const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
          if (match) {
            oldLine = parseInt(match[1], 10);
            newLine = parseInt(match[2], 10);
          }
          return (
            <div key={i} className="c3-diff-line hunk-header">
              {line}
            </div>
          );
        }

        if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('diff ')) {
          return (
            <div key={i} className="c3-diff-line hunk-header">
              {line}
            </div>
          );
        }

        if (line.startsWith('+')) {
          className = 'c3-diff-line add';
          lineNum = String(newLine++);
        } else if (line.startsWith('-')) {
          className = 'c3-diff-line del';
          lineNum = String(oldLine++);
        } else {
          lineNum = String(oldLine++);
          newLine++;
        }

        return (
          <div key={i} className={className}>
            <span className="c3-diff-line-number">{lineNum}</span>
            {line}
          </div>
        );
      })}

      {truncated && (
        <div className="c3-diff-line context" style={{ opacity: 0.5, fontStyle: 'italic' }}>
          ... ({lines.length - maxLines!} more lines)
        </div>
      )}
    </div>
  );
};
