import type { FC } from "react";

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
      className="card-thumbnail"
    >
      <div
        className="card-image"
        style={{ backgroundImage: image ? `url(${image})` : undefined }}
      >
        {!image && <div className="card-placeholder">No image</div>}
      </div>
      <div className="card-info">
        <div className="card-name">{name}</div>
        {price && <div className="card-price">${price.toFixed(2)}</div>}
      </div>
    </button>
  );
};
