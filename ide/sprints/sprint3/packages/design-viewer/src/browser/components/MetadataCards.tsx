/**
 * MetadataCards — Shows stack, decisions, sprint progress from project.json.
 */

import * as React from 'react';
import { DesignMetadata } from '../../common/design-viewer-protocol';

interface MetadataCardsProps {
  metadata: DesignMetadata;
}

export const MetadataCards: React.FC<MetadataCardsProps> = ({ metadata }) => {
  const stackEntries = Object.entries(metadata.stack);

  return (
    <div>
      {/* Stack + Sprint cards */}
      <div className="c3-design-meta">
        {stackEntries.length > 0 && (
          <div className="c3-design-meta-card">
            <div className="c3-design-meta-label">Stack</div>
            <div className="c3-design-meta-value">
              {stackEntries.map(([key, val]) => (
                <div key={key}>{key}: <strong>{val}</strong></div>
              ))}
            </div>
          </div>
        )}

        {metadata.totalSprints > 0 && (
          <div className="c3-design-meta-card">
            <div className="c3-design-meta-label">Sprinty</div>
            <div className="c3-design-meta-value">
              {metadata.currentSprint} / {metadata.totalSprints}
            </div>
          </div>
        )}

        <div className="c3-design-meta-card">
          <div className="c3-design-meta-label">Design turny</div>
          <div className="c3-design-meta-value">{metadata.designTurns}</div>
        </div>
      </div>

      {/* Decisions timeline */}
      {metadata.decisions.length > 0 && (
        <div className="c3-design-decisions">
          <h3 style={{ fontSize: '12px', fontWeight: 600, marginBottom: 8, color: 'var(--theia-descriptionForeground)' }}>
            Rozhodnutí ({metadata.decisions.length})
          </h3>
          {metadata.decisions.map((d, i) => (
            <div key={i} className="c3-design-decision">
              <div>
                <div className="c3-design-decision-what">{d.what}</div>
                <div className="c3-design-decision-why">{d.why}</div>
              </div>
              <div className="c3-design-decision-when">{d.when}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
