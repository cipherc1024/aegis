import os
from dstack_sdk import DstackClient

c = DstackClient()
rd = bytes.fromhex(os.environ["REPORT_DATA_HEX"])
q = c.get_quote(rd)
print("REPORT_DATA=" + rd.hex())
print("QUOTE_JSON=" + q.quote)
