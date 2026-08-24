import type React from 'react';
import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

interface PopoverPortalProps {
  children: React.ReactNode;
  isOpen: boolean;
  triggerRef: React.RefObject<any>;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

const PopoverPortal: React.FC<PopoverPortalProps> = ({ children, isOpen, triggerRef, onMouseEnter, onMouseLeave }) => {
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const dragHandleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Create portal container if it doesn't exist
    if (!portalContainer) {
      const div = document.createElement('div');
      div.id = 'mcp-popover-portal';
      div.style.position = 'absolute';
      div.style.zIndex = '10000';
      div.style.top = '0';
      div.style.left = '0';
      document.body.appendChild(div);
      setPortalContainer(div);
    }

    return () => {
      // Cleanup on unmount
      if (portalContainer && document.body.contains(portalContainer)) {
        document.body.removeChild(portalContainer);
      }
    };
  }, [portalContainer]);

  useEffect(() => {
    const updatePosition = () => {
      // Only update position if all required elements are available and not being dragged
      if (isOpen && portalContainer && triggerRef.current && !isDragging) {
        const triggerRect = triggerRef.current.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // Get the first child of the portal container (the popover)
        const popoverElement = portalContainer.firstElementChild?.firstElementChild as HTMLElement;
        if (!popoverElement) return;

        // Get the dimensions of the popover
        const popoverWidth = popoverElement.offsetWidth;
        const popoverHeight = popoverElement.offsetHeight;

        // Calculate the ideal position (centered above the trigger)
        let left = triggerRect.left + triggerRect.width / 2;
        let top = triggerRect.top - 10;
        let transformOrigin = 'center bottom';
        let transform = 'translate(-50%, -100%)';

        // Check if popover would go off the left edge of the screen
        if (left - popoverWidth / 2 < 10) {
          // Adjust to keep it within the viewport with some padding
          left = popoverWidth / 2 + 10;
        }

        // Check if popover would go off the right edge of the screen
        if (left + popoverWidth / 2 > viewportWidth - 10) {
          // Adjust to keep it within the viewport with some padding
          left = viewportWidth - popoverWidth / 2 - 10;
        }

        // Check if there's enough space above the trigger
        const spaceAbove = triggerRect.top;
        const spaceBelow = viewportHeight - triggerRect.bottom;

        // Check if there's enough space in each direction and position accordingly
        // First, check if we can position it below (preferred when near top of screen)
        if (
          triggerRect.top < popoverHeight + 30 ||
          (spaceAbove < popoverHeight + 20 && spaceBelow >= popoverHeight + 20)
        ) {
          // Position below the trigger
          top = triggerRect.bottom + 10;
          transform = 'translate(-50%, 0)';
          transformOrigin = 'center top';

          // If this would push it off the bottom of the screen, adjust
          if (top + popoverHeight > viewportHeight - 10) {
            // Position it as high as possible while keeping it below the trigger
            top = Math.min(top, viewportHeight - popoverHeight - 10);
          }

          // Update the popover's after pseudo-element position via a class
          if (popoverElement.classList) {
            popoverElement.classList.remove('position-above');
            popoverElement.classList.add('position-below');
          }
        } else {
          // Position above the trigger (default)
          top = triggerRect.top - 10;
          transform = 'translate(-50%, -100%)';
          transformOrigin = 'center bottom';

          // If this would push it off the top of the screen, adjust
          if (top - popoverHeight < 10) {
            // Position it as low as possible while keeping it above the trigger
            top = popoverHeight + 10;
          }

          // Update the popover's after pseudo-element position via a class
          if (popoverElement.classList) {
            popoverElement.classList.remove('position-below');
            popoverElement.classList.add('position-above');
          }
        }

        // Apply the calculated position
        portalContainer.style.position = 'fixed';
        portalContainer.style.left = `${left}px`;
        portalContainer.style.top = `${top}px`;
        portalContainer.style.transform = transform;

        // Update the position state
        setPosition({
          x: left,
          y: top,
        });

        // Set transform origin for smooth transitions if needed
        if (popoverElement) {
          popoverElement.style.transformOrigin = transformOrigin;
        }
      }
    };

    if (isOpen && portalContainer && triggerRef.current) {
      updatePosition();

      // Update position on scroll and resize
      window.addEventListener('scroll', updatePosition);
      window.addEventListener('resize', updatePosition);

      return () => {
        window.removeEventListener('scroll', updatePosition);
        window.removeEventListener('resize', updatePosition);
      };
    }
    return undefined;
  }, [isOpen, portalContainer, triggerRef]);

  // Handle drag start
  const handleDragStart = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!portalContainer) return;

    setIsDragging(true);

    // Calculate the offset from the mouse position to the portal container position
    const rect = portalContainer.getBoundingClientRect();
    setDragOffset({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });

    // Prevent text selection during drag
    e.preventDefault();
  };

  // Handle drag move
  const handleDragMove = (e: MouseEvent) => {
    if (!isDragging || !portalContainer) return;

    // Calculate new position
    const left = e.clientX - dragOffset.x;
    const top = e.clientY - dragOffset.y;

    // Apply the new position
    portalContainer.style.left = `${left}px`;
    portalContainer.style.top = `${top}px`;
    portalContainer.style.transform = 'none';

    // Update the position state
    setPosition({ x: left, y: top });
  };

  // Handle drag end
  const handleDragEnd = () => {
    setIsDragging(false);
  };

  // Add and remove event listeners for drag
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);
    } else {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
    }

    return () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
    };
  }, [isDragging]);

  if (!portalContainer || !isOpen) return null;

  return createPortal(
    <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} style={{ display: 'contents' }}>
      <div
        className="mcp-popover-wrapper"
        style={{
          position: 'relative',
          opacity: isDragging ? 0.9 : 1,
          backdropFilter: isDragging ? 'blur(12px)' : 'none',
          WebkitBackdropFilter: isDragging ? 'blur(12px)' : 'none',
          // backgroundColor: isDragging ? 'rgba(255, 255, 255, 0.7)' : 'transparent',
          transition: 'opacity 0.15s ease, backdrop-filter 0.15s ease, background-color 0.15s ease',
        }}>
        {children}
        <div ref={dragHandleRef} className="mcp-drag-handle" onMouseDown={handleDragStart} title="Drag to move" />
      </div>
    </div>,
    portalContainer,
  );
};

export default PopoverPortal;
