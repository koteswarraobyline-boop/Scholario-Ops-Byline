import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from './EmptyState';

export const NotFoundView: React.FC = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return (
    <div className="space-y-6">
      <h1 className="sr-only">Page not found</h1>
      <EmptyState
        icon={Compass}
        title="Page not found"
        description={`There is no page at ${pathname}. The link may be out of date or mistyped — use the sidebar or press Ctrl+K to search.`}
        action={{ label: 'Go to Overview', onClick: () => navigate('/overview') }}
      />
    </div>
  );
};
