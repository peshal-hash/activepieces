import { useEffect, useState } from 'react';
import facicon from "@/assets/img/logo/favicon.png"
function getAgentProfilePictureUrl(): string {
  return facicon;
}

interface AgentImageLoadingProps {
  loading: boolean;
}

export function AgentImageLoading({ loading }: AgentImageLoadingProps) {
  const [imageUrl, setImageUrl] = useState(getAgentProfilePictureUrl());

  useEffect(() => {
    if (!loading) return;

    const interval = setInterval(() => {
      setImageUrl(getAgentProfilePictureUrl());
    }, 200);

    return () => {
      clearInterval(interval);
    };
  }, [loading]);

  return (
    <div className="flex items-center justify-center">
      <img
        src={imageUrl}
        alt="Loading Agent"
        className="w-24 h-24 rounded-full border shadow-lg transition duration-75"
      />
    </div>
  );
}
