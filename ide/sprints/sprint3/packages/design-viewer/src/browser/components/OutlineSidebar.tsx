/**
 * OutlineSidebar — Navigable section tree for design document.
 */

import * as React from 'react';
import { OutlineSection } from '../../common/design-viewer-protocol';

interface OutlineSidebarProps {
  sections: OutlineSection[];
  activeId: string | null;
  onSelect: (section: OutlineSection) => void;
}

export const OutlineSidebar: React.FC<OutlineSidebarProps> = ({
  sections,
  activeId,
  onSelect,
}) => {
  // Group by source
  const archSections = sections.filter(s => s.source === 'architecture');
  const sprintSections = sections.filter(s => s.source === 'sprints');

  return (
    <div className="c3-design-outline">
      {archSections.length > 0 && (
        <>
          <span className="c3-outline-source-label">Architektura</span>
          {archSections.map(s => renderItem(s, activeId, onSelect))}
        </>
      )}

      {sprintSections.length > 0 && (
        <>
          <span className="c3-outline-source-label">Sprinty</span>
          {sprintSections.map(s => renderItem(s, activeId, onSelect))}
        </>
      )}

      {sections.length === 0 && (
        <span className="c3-outline-source-label" style={{ opacity: 0.4 }}>
          Žádné sekce
        </span>
      )}
    </div>
  );
};

function renderItem(
  section: OutlineSection,
  activeId: string | null,
  onSelect: (s: OutlineSection) => void,
): React.ReactNode {
  return (
    <React.Fragment key={section.id}>
      <button
        className={`c3-outline-item ${section.id === activeId ? 'active' : ''}`}
        data-level={section.level}
        onClick={() => onSelect(section)}
        title={section.title}
      >
        {section.title}
      </button>

      {section.children.map(child => renderItem(child, activeId, onSelect))}
    </React.Fragment>
  );
}
