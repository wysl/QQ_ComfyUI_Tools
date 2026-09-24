"""QQ ComfyUI Tools.

This package contains utility nodes that can be installed alongside the
upstream MiniMax H3 node package.  It deliberately does not register or
replace any MiniMax H3 model nodes.
"""

from .node_modules import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
