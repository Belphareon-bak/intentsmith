import * as React from 'react';
import { GlassCard, Badge } from '../../../../c3-chat-panel/src/browser/components/ui';

/**
 * Project card with Pro mode design (glassmorphism)
 */
interface ProjectCardProProps {
  project: {
    id: string;
    name: string;
    path?: string;
    status?: 'active' | 'archived' | 'draft';
    language?: string;
    lastModified?: Date;
    filesCount?: number;
  };
  onClick?: () => void;
  onArchive?: () => void;
}

export function ProjectCardPro({ project, onClick, onArchive }: ProjectCardProProps) {
  const statusColors = {
    active: 'success',
    archived: 'secondary',
    draft: 'warning',
  } as const;

  const statusLabels = {
    active: 'Aktivní',
    archived: 'Archivováno',
    draft: 'Koncept',
  };

  return (
    <GlassCard
      hover
      shine
      glow
      onClick={onClick}
      className="min-w-[280px] max-w-[320px] group"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-c3-tx1 mb-1 truncate flex items-center gap-2">
            <span className="text-xl">📁</span>
            {project.name}
          </h3>
          {project.path && (
            <p className="text-xs text-c3-tx4 truncate font-mono">{project.path}</p>
          )}
        </div>
        {project.status && (
          <Badge variant={statusColors[project.status]} className="flex-shrink-0 ml-2">
            {statusLabels[project.status]}
          </Badge>
        )}
      </div>

      {/* Info */}
      <div className="flex items-center gap-4 text-xs text-c3-tx3 mb-3">
        {project.language && (
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-c3-accent" />
            <span>{project.language}</span>
          </div>
        )}
        {project.filesCount !== undefined && (
          <div className="flex items-center gap-1">
            <span>📄</span>
            <span>{project.filesCount} souborů</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-c3-tx4 mt-4 pt-3 border-t border-c3-border">
        <span>
          {project.lastModified &&
            new Date(project.lastModified).toLocaleDateString('cs-CZ', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
        </span>
        {onArchive && project.status !== 'archived' && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-c3-tx4 hover:text-c3-accent"
          >
            Archivovat
          </button>
        )}
      </div>

      {/* Animated gradient border on hover */}
      <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
        <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-c3-accent/20 via-transparent to-c3-accent/20 animate-gradient-x" />
      </div>
    </GlassCard>
  );
}
