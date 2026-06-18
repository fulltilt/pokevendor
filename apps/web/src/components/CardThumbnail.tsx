import type { FC } from "react";
import { cn } from "../lib/utils";

interface CardProps {
  id: string;
  name: string;
  image?: string;
  price?: number;
  onClick: (cardId: string) => void;
}

export const CardThumbnail: FC<CardProps> = ({
  id,
  name,
  image,
  price,
  onClick,
}) => {
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className={cn(
        "card-thumbnail flex flex-col overflow-hidden rounded-[18px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(0,0,0,0.12))] text-left shadow-[0_18px_36px_rgba(0,0,0,0.24)] transition duration-200",
        "hover:-translate-y-1 hover:rotate-[-0.3deg] hover:border-[rgba(242,181,68,0.48)] hover:shadow-[0_24px_42px_rgba(0,0,0,0.28)]",
      )}
    >
      <div
        className="card-image flex aspect-[2/3] min-h-[152px] w-full items-center justify-center bg-white/4 bg-cover bg-center"
        style={{ backgroundImage: image ? `url(${image})` : undefined }}
      >
        {!image && (
          <div className="card-placeholder px-3 text-center text-xs text-[var(--text-secondary)]">
            No image
          </div>
        )}
      </div>
      <div className="card-info flex flex-1 flex-col justify-end bg-[linear-gradient(180deg,rgba(11,31,38,0.1),rgba(11,31,38,0.68))] p-3">
        <div className="card-name line-clamp-2 text-[0.8rem] font-bold leading-[1.35] text-[var(--text-primary)]">
          {name}
        </div>
        {price && (
          <div className="card-price mt-1 text-xs font-bold text-[var(--accent-hover)]">
            ${price.toFixed(2)}
          </div>
        )}
      </div>
    </button>
  );
};
